import type { Db } from "@kr/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { openDb, until } from "../../test/db.js";
import { captureLog } from "../../test/log.js";
import { createSweeper, type SweepTask } from "./runner.js";

let db: Db;
beforeAll(() => {
  db = openDb();
});
afterAll(async () => {
  await db.destroy();
});

const task = (name: string, run: SweepTask["run"]): SweepTask => ({ name, run });

describe("the sweeper", () => {
  it("runs the tasks in order with cut-offs from the injected clock and reports their counts", async () => {
    const seen: Date[] = [];
    const { log } = captureLog();
    const sweeper = createSweeper({
      db,
      log,
      clock: { now: () => new Date("2026-10-09T08:00:00.000Z") },
      tasks: [
        task("a", (c) => {
          seen.push(c.filesDeletedBefore);
          return Promise.resolve({ rows: 2 });
        }),
        task("b", () => Promise.resolve({ rows: 0 })),
      ],
    });
    expect(await sweeper.runOnce()).toEqual({ a: { rows: 2 }, b: { rows: 0 } });
    expect(seen).toEqual([new Date("2026-09-09T08:00:00.000Z")]);
  });

  it("lets only one sweep run at a time, across workers, and releases the lock afterwards", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const slow = vi.fn(async () => {
      await gate;
      return {};
    });
    const first = createSweeper({ db, log: captureLog().log, tasks: [task("slow", slow)] });
    const second = createSweeper({ db, log: captureLog().log, tasks: [task("slow", slow)] });
    const running = first.runOnce();
    await until(
      () => Promise.resolve(slow.mock.calls.length),
      (n) => n === 1,
    );
    expect(await second.runOnce()).toBe("skipped");
    release();
    await running;
    expect(await second.runOnce()).toEqual({ slow: {} });
    expect(slow).toHaveBeenCalledTimes(2);
  });

  it("logs a failing task and still runs the others, and still releases the lock", async () => {
    const { log, events } = captureLog();
    const sweeper = createSweeper({
      db,
      log,
      tasks: [task("bad", () => Promise.reject(new Error("boom"))), task("good", () => Promise.resolve({ ok: 1 }))],
    });
    expect(await sweeper.runOnce()).toEqual({ bad: "failed", good: { ok: 1 } });
    expect(events()).toContain("sweep_task_failed");
    expect(await sweeper.runOnce()).not.toBe("skipped");
  });

  it("sweeps on a schedule and stop() waits for a sweep in progress", async () => {
    const run = vi.fn(() => Promise.resolve({}));
    const sweeper = createSweeper({
      db,
      log: captureLog().log,
      tasks: [task("t", run)],
      firstDelayMs: 10,
      intervalMs: 30,
    });
    sweeper.start();
    await until(
      () => Promise.resolve(run.mock.calls.length),
      (n) => n >= 2,
    );
    await sweeper.stop();
    const calls = run.mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(run.mock.calls.length).toBe(calls);
  });
});
