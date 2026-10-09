import type { Db } from "@kr/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { enqueue, insertJob, openDb, operation, until } from "../test/db.js";
import { captureLog } from "../test/log.js";
import { TaskError } from "./errors.js";
import type { Handler, Handlers } from "./handlers/types.js";
import { Poller } from "./poller.js";

let db: Db;
let jobId: string;
beforeAll(async () => {
  db = openDb();
  jobId = await insertJob(db);
});
afterAll(async () => {
  await db.destroy();
});
beforeEach(async () => {
  await db.deleteFrom("operations").execute();
});

const metrics = () => ({ recordOperation: vi.fn() });

function makePoller(
  handlers: Handlers,
  extra: { workerId?: string; leaseSeconds?: number; concurrency?: number } = {},
) {
  const captured = captureLog();
  const m = metrics();
  const poller = new Poller({
    db,
    workerId: extra.workerId ?? "worker-a",
    handlers,
    log: captured.log,
    metrics: m,
    concurrency: extra.concurrency ?? 2,
    pollIntervalMs: 20,
    leaseSeconds: extra.leaseSeconds ?? 60,
    requeueIntervalMs: 50,
  });
  return { poller, metrics: m, events: captured.events };
}

const handler = (run: Handler["run"]): Handler => ({ run });

describe("the poller", () => {
  it("runs the handler of the operation's type and stores the result", async () => {
    const op = await enqueue(db, jobId, "file.scan", { fileId: "f1" });
    const { poller, metrics: m } = makePoller({
      "file.scan": handler((ctx) => Promise.resolve({ seen: ctx.operation.payload })),
    });
    poller.start();
    const done = await until(
      () => operation(db, op.id),
      (o) => o.status === "succeeded",
    );
    expect(await poller.stop(1000)).toBe(true);
    expect(done.result).toEqual({ seen: { fileId: "f1" } });
    expect(done.attempts).toBe(1);
    expect(m.recordOperation).toHaveBeenCalledWith(expect.objectContaining({ type: "file.scan", status: "succeeded" }));
  });

  it("claims only the types it has a handler for", async () => {
    const other = await enqueue(db, jobId, "email.parse");
    const mine = await enqueue(db, jobId, "file.scan");
    const { poller } = makePoller({ "file.scan": handler(() => Promise.resolve(null)) });
    poller.start();
    await until(
      () => operation(db, mine.id),
      (o) => o.status === "succeeded",
    );
    await poller.stop(1000);
    expect((await operation(db, other.id)).status).toBe("queued");
  });

  it("never runs an operation twice with two workers polling the same queue", async () => {
    const ops = await Promise.all(Array.from({ length: 40 }, () => enqueue(db, jobId, "file.scan")));
    const runs = new Map<string, string[]>();
    const run = (worker: string): Handler =>
      handler(async (ctx) => {
        runs.set(ctx.operation.id, [...(runs.get(ctx.operation.id) ?? []), worker]);
        await new Promise((resolve) => setTimeout(resolve, 10));
        return worker;
      });
    const a = makePoller({ "file.scan": run("a") }, { workerId: "worker-a", concurrency: 4 });
    const b = makePoller({ "file.scan": run("b") }, { workerId: "worker-b", concurrency: 4 });
    a.poller.start();
    b.poller.start();
    await until(
      () => db.selectFrom("operations").select("status").execute(),
      (rows) => rows.every((r) => r.status === "succeeded"),
    );
    await Promise.all([a.poller.stop(1000), b.poller.stop(1000)]);
    expect(runs.size).toBe(40);
    for (const op of ops) expect(runs.get(op.id)).toHaveLength(1);
    const winners = new Set([...runs.values()].flat());
    expect(winners).toEqual(new Set(["a", "b"]));
  });

  it("re-queues an operation whose worker died and runs it once", async () => {
    const op = await enqueue(db, jobId, "file.scan");
    await db
      .updateTable("operations")
      .set({ status: "running", locked_by: "dead-worker", locked_until: new Date(Date.now() - 1000), attempts: 1 })
      .where("id", "=", op.id)
      .execute();
    const run = vi.fn(() => Promise.resolve("ok"));
    const { poller, events } = makePoller({ "file.scan": handler(run) });
    poller.start();
    const done = await until(
      () => operation(db, op.id),
      (o) => o.status === "succeeded",
    );
    await poller.stop(1000);
    expect(done.attempts).toBe(2);
    expect(run).toHaveBeenCalledTimes(1);
    expect(events()).toContain("leases_requeued");
  });
});

describe("failures", () => {
  async function failWith(error: Error, maxAttempts = 3) {
    const op = await enqueue(db, jobId, "file.scan", {}, maxAttempts);
    const { poller, metrics: m, events } = makePoller({ "file.scan": handler(() => Promise.reject(error)) });
    poller.start();
    const row = await until(
      () => operation(db, op.id),
      (o) => o.status !== "queued" && o.status !== "running",
    );
    await poller.stop(1000);
    return { row, m, events };
  }

  it("fails a permanent TaskError at once with its code and user-safe message", async () => {
    const { row, m } = await failWith(new TaskError("not_a_pdf", "That file is not a PDF, so it could not be read."));
    expect(row.status).toBe("failed");
    expect(row.error_code).toBe("not_a_pdf");
    expect(row.error_message).toBe("That file is not a PDF, so it could not be read.");
    expect(m.recordOperation).toHaveBeenCalledWith(expect.objectContaining({ status: "failed" }));
  });

  it("treats an unexpected throw as a retryable internal error and stores none of its text", async () => {
    const { row, events } = await failWith(new Error("select * from users where email = 'a@b.test' failed"));
    expect(row.status).toBe("queued");
    expect(row.run_after.getTime()).toBeGreaterThan(Date.now() + 5000);
    expect(row.error_code).toBe("internal_error");
    expect(row.error_message).not.toContain("a@b.test");
    expect(events()).toContain("operation_requeued");
  });
});
