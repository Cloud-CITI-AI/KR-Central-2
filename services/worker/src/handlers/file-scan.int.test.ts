import type { Db } from "@kr/db";
import { createMemoryStorage } from "@kr/storage/testing";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { FAKE_VIRUS, startFakeClamd, type FakeClamd } from "../../test/fake-clamd.js";
import { enqueue, insertJob, openDb } from "../../test/db.js";
import { fileRow, handlerContext, insertFile } from "../../test/files.js";
import { createClamdClient } from "../clients/clamd.js";
import { fileScanHandler } from "./file-scan.js";

let db: Db;
let jobId: string;
let clamd: FakeClamd;
const storage = createMemoryStorage();
const metrics = { recordFileScan: vi.fn() };

beforeAll(async () => {
  db = openDb();
  jobId = await insertJob(db);
});
afterAll(async () => {
  await db.destroy();
});
beforeEach(async () => {
  metrics.recordFileScan.mockClear();
  await db.deleteFrom("operations").execute();
  clamd = await startFakeClamd();
});
afterEach(async () => {
  await clamd.stop();
});

function handler(mode: "required" | "disabled" = "required") {
  return fileScanHandler({
    db,
    storage,
    clamd: createClamdClient({ host: "127.0.0.1", port: clamd.port, timeoutMs: 1000, maxBytes: 1024 * 1024 }),
    config: { MALWARE_SCAN_MODE: mode, CLAMAV_TIMEOUT_MS: 1000 },
    metrics,
  });
}

async function run(fileId: string, o: { attempt?: number; mode?: "required" | "disabled"; maxAttempts?: number } = {}) {
  const op = await enqueue(db, jobId, "file.scan", { fileId }, o.maxAttempts);
  const ctx = handlerContext(op, { attempt: o.attempt ?? 1 });
  return {
    ctx,
    outcome: await handler(o.mode)
      .run(ctx)
      .then(
        (result) => ({ result }),
        (error: unknown) => ({ error }),
      ),
  };
}

describe("file.scan", () => {
  it("marks a clean file clean and leaves the object in place", async () => {
    const file = await insertFile(db, storage, jobId);
    const { outcome } = await run(file.id);
    expect(outcome).toEqual({ result: { scanStatus: "clean" } });
    const row = await fileRow(db, file.id);
    expect(row.scan_status).toBe("clean");
    expect(row.scanned_at).toBeInstanceOf(Date);
    expect(await storage.exists(file.key)).toBe(true);
    expect(metrics.recordFileScan).toHaveBeenCalledExactlyOnceWith("clean");
  });

  it("deletes an infected object, records the signature, audits as the system and alerts through the log and a metric", async () => {
    const file = await insertFile(db, storage, jobId, { bytes: `a ${FAKE_VIRUS} b` });
    const { ctx, outcome } = await run(file.id);
    expect(outcome).toEqual({ result: { scanStatus: "infected" } });
    const row = await fileRow(db, file.id);
    expect([row.scan_status, row.scan_detail]).toEqual(["infected", "Fake.Virus-1"]);
    expect(await storage.exists(file.key)).toBe(false);
    const audit = await db.selectFrom("audit_events").selectAll().where("entity_id", "=", file.id).execute();
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actor_type: "system",
      actor_user_id: null,
      action: "file.infected",
      job_id: jobId,
    });
    expect(metrics.recordFileScan).toHaveBeenCalledExactlyOnceWith("infected");
    expect(ctx.captured.events()).toContain("malware_detected");
  });

  it("leaves a verdict that is already recorded alone when it is re-run", async () => {
    const file = await insertFile(db, storage, jobId, { scanStatus: "clean" });
    const before = await fileRow(db, file.id);
    expect((await run(file.id)).outcome).toEqual({ result: { scanStatus: "clean" } });
    expect(await fileRow(db, file.id)).toEqual(before);
  });

  it("finishes the deletion when it is re-run after the verdict was recorded", async () => {
    const file = await insertFile(db, storage, jobId, { scanStatus: "infected" });
    await run(file.id);
    expect(await storage.exists(file.key)).toBe(false);
  });

  it("skips scanning when it is switched off", async () => {
    const file = await insertFile(db, storage, jobId);
    await clamd.stop();
    expect((await run(file.id, { mode: "disabled" })).outcome).toEqual({ result: { scanStatus: "skipped" } });
    expect((await fileRow(db, file.id)).scan_status).toBe("skipped");
  });

  it("ignores a file that was deleted meanwhile", async () => {
    const file = await insertFile(db, storage, jobId);
    await db.updateTable("files").set({ deleted_at: new Date() }).where("id", "=", file.id).execute();
    expect((await run(file.id)).outcome).toEqual({ result: { scanStatus: "gone" } });
    expect((await fileRow(db, file.id)).scan_status).toBe("pending");
  });

  it("re-scans a file whose scan ended in error", async () => {
    const file = await insertFile(db, storage, jobId, { scanStatus: "error", scanAttempts: 1 });
    await run(file.id);
    const row = await fileRow(db, file.id);
    expect([row.scan_status, row.scan_attempts]).toEqual(["clean", 1]);
  });

  it("rejects a payload that is not a file id", async () => {
    const { outcome } = await run("not-a-uuid");
    expect(outcome).toMatchObject({ error: { code: "invalid_payload", retryable: false } });
  });
});
