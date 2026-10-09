import type { Db } from "@kr/db";
import { createMemoryStorage } from "@kr/storage/testing";
import { createMetrics } from "@kr/telemetry";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { enqueue, insertJob, openDb, operation, until } from "../test/db.js";
import { insertFile } from "../test/files.js";
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

function start(sweepTiming?: { firstDelayMs: number; intervalMs: number }): Promise<RunningWorker> {
  return startWorker({
    ...(sweepTiming ? { sweepTiming } : {}),
    config: {
      HOST: "127.0.0.1",
      PORT: 0,
      WORKER_CONCURRENCY: 1,
      WORKER_POLL_INTERVAL_MS: 20,
      WORKER_LEASE_SECONDS: 30,
      SCAN_ERROR_MAX_RETRIES: 3,
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

  it("sweeps on its schedule: a stuck pending file and a retryable error file get a new scan, an exhausted one does not", async () => {
    await db.deleteFrom("operations").execute();
    const storage = createMemoryStorage();
    const old = new Date(Date.now() - 3_600_000);
    const stuck = await insertFile(db, storage, jobId, { scanStatus: "pending" });
    await db.updateTable("files").set({ uploaded_at: old }).where("id", "=", stuck.id).execute();
    const retry = await insertFile(db, storage, jobId, { scanStatus: "error", scanAttempts: 1 });
    const exhausted = await insertFile(db, storage, jobId, { scanStatus: "error", scanAttempts: 4 });
    const worker = await start({ firstDelayMs: 20, intervalMs: 60_000 });
    const scans = await until(
      () =>
        db
          .selectFrom("operations")
          .select(["status", "payload"])
          .where("type", "=", "file.scan")
          .where("job_id", "=", jobId)
          .execute(),
      (rows) => rows.length >= 2 && rows.every((r) => r.status === "succeeded"),
    );
    expect(await worker.drain(2000)).toBe(true);
    await worker.close();
    expect(scans.map((r) => (r.payload as { fileId: string }).fileId).sort()).toEqual([retry.id, stuck.id].sort());
    const states = await db
      .selectFrom("files")
      .select(["id", "scan_status"])
      .where("id", "in", [retry.id, exhausted.id])
      .execute();
    expect(Object.fromEntries(states.map((r) => [r.id, r.scan_status]))).toEqual({
      [retry.id]: "pending",
      [exhausted.id]: "error",
    });
  });
});
