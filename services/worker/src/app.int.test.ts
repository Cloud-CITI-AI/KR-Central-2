import type { Db } from "@kr/db";
import { createMemoryStorage } from "@kr/storage/testing";
import { createMetrics } from "@kr/telemetry";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { enqueue, insertJob, openDb, operation, until } from "../test/db.js";
import { captureLog } from "../test/log.js";
import { startWorker, type RunningWorker } from "./app.js";
import { systemClock } from "./clock.js";

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

function start(): Promise<RunningWorker> {
  return startWorker({
    config: {
      HOST: "127.0.0.1",
      PORT: 0,
      WORKER_CONCURRENCY: 1,
      WORKER_POLL_INTERVAL_MS: 20,
      WORKER_LEASE_SECONDS: 30,
    },
    db,
    storage: createMemoryStorage(),
    log: captureLog().log,
    metrics: createMetrics({
      operationTypes: ["file.scan", "email.parse"],
      operationStatuses: ["succeeded", "failed"] as const,
    }),
    clock: systemClock,
    workerId: "test-worker",
    handlers: { "file.scan": { timeoutMs: 5000, run: () => Promise.resolve({ scanned: true }) } },
  });
}

describe("the running worker", () => {
  it("is ready when the database and the store answer, and processes queued operations", async () => {
    const worker = await start();
    const ready = await fetch(`http://127.0.0.1:${worker.healthPort}/readyz`);
    expect(ready.status).toBe(200);
    expect(await ready.json()).toEqual({ status: "ok", draining: false, checks: { database: "ok", storage: "ok" } });
    const op = await enqueue(db, jobId, "file.scan");
    const done = await until(
      () => operation(db, op.id),
      (o) => o.status === "succeeded",
    );
    expect(done.result).toEqual({ scanned: true });
    expect(await worker.drain(1000)).toBe(true);
    await worker.close();
  });

  it("leaves rotation (503, draining) as soon as it is asked to stop, and stops claiming", async () => {
    const worker = await start();
    expect(await worker.drain(1000)).toBe(true);
    const res = await fetch(`http://127.0.0.1:${worker.healthPort}/readyz`);
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ draining: true });
    const op = await enqueue(db, jobId, "file.scan");
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect((await operation(db, op.id)).status).toBe("queued");
    await worker.close();
  });
});
