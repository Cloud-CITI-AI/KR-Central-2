import type { Db } from "@kr/db";
import { createMemoryStorage } from "@kr/storage/testing";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { FAKE_VIRUS, startFakeClamd, type FakeClamd } from "../../test/fake-clamd.js";
import { enqueue, insertJob, openDb } from "../../test/db.js";
import { fileRow, handlerContext, insertFile } from "../../test/files.js";
import { createClamdClient } from "../clients/clamd.js";
import type { TaskError } from "../errors.js";
import { staticFlags } from "../flags.js";
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

function handler(mode: "required" | "disabled" = "required", flag = false) {
  return fileScanHandler({
    db,
    storage,
    clamd: createClamdClient({ host: "127.0.0.1", port: clamd.port, timeoutMs: 5000, maxBytes: 1024 * 1024 }),
    config: { MALWARE_SCAN_MODE: mode, CLAMAV_TIMEOUT_MS: 1000, SCAN_ERROR_MAX_RETRIES: 3 },
    flags: staticFlags({ "ai-stamp-reading": flag }),
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
    expect(outcome).toEqual({ result: { scanStatus: "clean", followUpOperationId: null } });
    const row = await fileRow(db, file.id);
    expect(row.scan_status).toBe("clean");
    expect(row.scanned_at).toBeInstanceOf(Date);
    expect(await storage.exists(file.key)).toBe(true);
    expect(metrics.recordFileScan).toHaveBeenCalledExactlyOnceWith("clean");
  });

  it("deletes an infected object, records the signature, audits as the system and alerts through the log and a metric", async () => {
    const file = await insertFile(db, storage, jobId, { bytes: `a ${FAKE_VIRUS} b` });
    const { ctx, outcome } = await run(file.id);
    expect(outcome).toEqual({ result: { scanStatus: "infected", followUpOperationId: null } });
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

  it("blocks content past a clamd scan limit like malware: infected, object deleted, not retried", async () => {
    await clamd.stop();
    clamd = await startFakeClamd({ reply: "limit-exceeded" });
    const file = await insertFile(db, storage, jobId, { bytes: "a deeply nested archive" });
    const { ctx, outcome } = await run(file.id);
    expect(outcome).toEqual({ result: { scanStatus: "infected", followUpOperationId: null } });
    const row = await fileRow(db, file.id);
    expect([row.scan_status, row.scan_detail]).toEqual(["infected", "Heuristics.Limits.Exceeded.MaxRecursion"]);
    expect(await storage.exists(file.key)).toBe(false);
    const audit = await db.selectFrom("audit_events").selectAll().where("entity_id", "=", file.id).execute();
    expect(audit.map((a) => a.action)).toEqual(["file.infected"]);
    expect(metrics.recordFileScan).toHaveBeenCalledExactlyOnceWith("infected");
    expect(ctx.captured.events()).toContain("malware_detected");
  });

  it("leaves a verdict that is already recorded alone when it is re-run", async () => {
    const file = await insertFile(db, storage, jobId, { scanStatus: "clean" });
    const before = await fileRow(db, file.id);
    expect((await run(file.id)).outcome).toEqual({ result: { scanStatus: "clean", followUpOperationId: null } });
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
    expect((await run(file.id, { mode: "disabled" })).outcome).toEqual({
      result: { scanStatus: "skipped", followUpOperationId: null },
    });
    expect((await fileRow(db, file.id)).scan_status).toBe("skipped");
  });

  it("ignores a file that was deleted meanwhile", async () => {
    const file = await insertFile(db, storage, jobId);
    await db.updateTable("files").set({ deleted_at: new Date() }).where("id", "=", file.id).execute();
    expect((await run(file.id)).outcome).toEqual({ result: { scanStatus: "gone", followUpOperationId: null } });
    expect((await fileRow(db, file.id)).scan_status).toBe("pending");
  });

  it("re-scans a file whose scan ended in error", async () => {
    const file = await insertFile(db, storage, jobId, { scanStatus: "error", scanAttempts: 1 });
    await run(file.id);
    const row = await fileRow(db, file.id);
    expect([row.scan_status, row.scan_attempts]).toEqual(["clean", 1]);
  });

  it("clears scan_retries_exhausted when a later scan passes", async () => {
    const file = await insertFile(db, storage, jobId, {
      scanStatus: "error",
      scanAttempts: 4,
      scanRetriesExhausted: true,
    });
    await run(file.id);
    const row = await fileRow(db, file.id);
    expect([row.scan_status, row.scan_retries_exhausted]).toEqual(["clean", false]);
  });

  it("rejects a payload that is not a file id", async () => {
    const { outcome } = await run("not-a-uuid");
    expect(outcome).toMatchObject({ error: { code: "invalid_payload", retryable: false } });
  });
});

describe("file.scan: email follow-up", () => {
  async function emailFile(o: { pasted?: boolean; status?: "pending" | "parsed" } = {}) {
    const file = await insertFile(db, storage, jobId, {
      kind: "email",
      checkpointKey: "i4_3",
      slot: "email",
      name: "query.eml",
    });
    await db
      .insertInto("email_messages")
      .values({ file_id: file.id, parse_status: o.status ?? "pending", is_pasted: o.pasted ?? false })
      .execute();
    return file;
  }
  const queued = (fileId: string) =>
    db
      .selectFrom("operations")
      .selectAll()
      .where("type", "=", "email.parse")
      .where("job_id", "=", jobId)
      .execute()
      .then((rows) => rows.filter((r) => (r.payload as { fileId?: string }).fileId === fileId));

  it("queues email.parse once for a clean uploaded email, even when the scan is re-run", async () => {
    const file = await emailFile();
    const first = await run(file.id);
    const second = await run(file.id);
    const ops = await queued(file.id);
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ status: "queued", created_by: null });
    // The scan's result names the parse, and a re-run names the one already queued.
    const expected = { result: { scanStatus: "clean", followUpOperationId: ops[0]?.id } };
    expect(first.outcome).toEqual(expected);
    expect(second.outcome).toEqual(expected);
  });

  it("does not queue it for a pasted or already parsed email, or for infected content", async () => {
    const pasted = await emailFile({ pasted: true, status: "parsed" });
    expect((await run(pasted.id)).outcome).toEqual({ result: { scanStatus: "clean", followUpOperationId: null } });
    expect(await queued(pasted.id)).toHaveLength(0);
    const bad = await insertFile(db, storage, jobId, {
      kind: "email",
      bytes: FAKE_VIRUS,
      checkpointKey: "i4_3",
      slot: "email",
    });
    await db.insertInto("email_messages").values({ file_id: bad.id }).execute();
    await run(bad.id);
    expect(await queued(bad.id)).toHaveLength(0);
  });
});

describe("file.scan: conformance read follow-up (PRODUCT_SPEC §5.5 conformance)", () => {
  const notice = (
    o: { name?: string; kind?: "pdf" | "image"; slot?: string; checkpointKey?: string; bytes?: string } = {},
  ) =>
    insertFile(db, storage, jobId, {
      kind: o.kind ?? "pdf",
      checkpointKey: o.checkpointKey ?? "i4_2",
      slot: o.slot ?? "conformance",
      name: o.name ?? "Conformance Notification 2026-07-20.pdf",
      ...(o.bytes ? { bytes: o.bytes } : {}),
    });
  const reads = (fileId?: string) =>
    db
      .selectFrom("operations")
      .selectAll()
      .where("type", "=", "conformance.read")
      .where("job_id", "=", jobId)
      .execute()
      .then((rows) => rows.filter((r) => fileId === undefined || (r.payload as { fileId?: string }).fileId === fileId));

  it("queues one conformance.read for a clean PDF in 4.2 / conformance, even when the scan is re-run", async () => {
    const file = await notice();
    const first = await run(file.id);
    const second = await run(file.id);
    const ops = await reads(file.id);
    expect(ops).toHaveLength(1);
    // The scan's result names the read, and a re-run names the one already queued instead of queuing another.
    const expected = { result: { scanStatus: "clean", followUpOperationId: ops[0]?.id } };
    expect(first.outcome).toEqual(expected);
    expect(second.outcome).toEqual(expected);
    expect(ops[0]).toMatchObject({
      status: "queued",
      created_by: null,
      payload: { jobId, fileId: file.id, allowAi: false },
    });
  });

  it("queues it for a skipped scan (scanning disabled) and passes the AI flag as it stands", async () => {
    const file = await notice();
    const op = await enqueue(db, jobId, "file.scan", { fileId: file.id });
    const result = await handler("disabled", true).run(handlerContext(op));
    expect((await fileRow(db, file.id)).scan_status).toBe("skipped");
    const ops = await reads(file.id);
    expect(ops).toMatchObject([{ payload: { fileId: file.id, allowAi: true } }]);
    expect(result).toEqual({ scanStatus: "skipped", followUpOperationId: ops[0]?.id });
  });

  it("queues a new one when the earlier read failed, but not while one is queued or running", async () => {
    const file = await notice();
    await run(file.id);
    await db.updateTable("operations").set({ status: "failed" }).where("type", "=", "conformance.read").execute();
    const again = await run(file.id);
    const ops = await reads(file.id);
    expect(ops.map((o) => o.status).sort()).toEqual(["failed", "queued"]);
    expect(again.outcome).toEqual({
      result: { scanStatus: "clean", followUpOperationId: ops.find((o) => o.status === "queued")?.id },
    });
  });

  it("queues none for another slot or checkpoint, a non-PDF, or infected content", async () => {
    for (const file of [
      await notice({ slot: "decision", checkpointKey: "i5_0" }),
      await notice({ kind: "image", name: "scan.png" }),
      await notice({ bytes: FAKE_VIRUS }),
    ]) {
      expect((await run(file.id)).outcome).toMatchObject({ result: { followUpOperationId: null } });
    }
    expect(await reads()).toHaveLength(0);
  });
});

describe("file.scan: failures", () => {
  const failed = (outcome: unknown) => (outcome as { error: TaskError }).error;

  it("asks the queue to retry while attempts remain and leaves the file pending", async () => {
    const file = await insertFile(db, storage, jobId);
    await clamd.stop();
    const { outcome } = await run(file.id, { attempt: 1 });
    expect(failed(outcome)).toMatchObject({ code: "scan_unavailable", retryable: true });
    const row = await fileRow(db, file.id);
    expect([row.scan_status, row.scan_attempts]).toEqual(["pending", 0]);
    expect(metrics.recordFileScan).not.toHaveBeenCalled();
  });

  it("records an error on the last attempt, counts the failed scan and fails the operation for good", async () => {
    const file = await insertFile(db, storage, jobId);
    await clamd.stop();
    const { ctx, outcome } = await run(file.id, { attempt: 3 });
    expect(failed(outcome)).toMatchObject({ code: "scan_error", retryable: false });
    const row = await fileRow(db, file.id);
    expect([row.scan_status, row.scan_attempts, row.scan_detail]).toEqual([
      "error",
      1,
      "The virus scanner could not be reached.",
    ]);
    expect(metrics.recordFileScan).toHaveBeenCalledExactlyOnceWith("error");
    expect(ctx.captured.events()).toContain("scan_failed");
    // the first failure is not the last: the hourly sweep will scan it again, so the tracker must not say "upload it again"
    expect(row.scan_retries_exhausted).toBe(false);
  });

  it("marks the retries exhausted on the failure after the last re-scan (SCAN_ERROR_MAX_RETRIES = 3 -> failure 4), not before", async () => {
    await clamd.stop();
    for (const [attempts, exhausted] of [
      [0, false],
      [2, false],
      [3, true],
    ] as const) {
      const file = await insertFile(db, storage, jobId, { scanStatus: "error", scanAttempts: attempts });
      await run(file.id, { attempt: 3 });
      const row = await fileRow(db, file.id);
      expect([row.scan_attempts, row.scan_retries_exhausted]).toEqual([attempts + 1, exhausted]);
    }
  });

  it("records an error at once when the object is missing, and alerts when the retries are used up", async () => {
    const file = await insertFile(db, storage, jobId, { noObject: true, scanStatus: "error", scanAttempts: 3 });
    const { ctx, outcome } = await run(file.id, { attempt: 1 });
    expect(failed(outcome).code).toBe("scan_error");
    const row = await fileRow(db, file.id);
    expect([row.scan_attempts, row.scan_detail]).toEqual([4, "The stored file could not be found."]);
    expect(row.scan_retries_exhausted).toBe(true);
    expect(ctx.captured.events()).toContain("scan_retries_exhausted");
  });

  it("marks the retries exhausted at once when retrying cannot help (the object is missing)", async () => {
    const file = await insertFile(db, storage, jobId, { noObject: true });
    await run(file.id, { attempt: 1 });
    const row = await fileRow(db, file.id);
    expect([row.scan_status, row.scan_attempts, row.scan_retries_exhausted]).toEqual(["error", 1, true]);
  });

  it("with the clamd circuit open, fails fast, keeps the file pending and has the queue try again later", async () => {
    const file = await insertFile(db, storage, jobId);
    await clamd.stop();
    const client = createClamdClient({
      host: "127.0.0.1",
      port: clamd.port,
      timeoutMs: 5000,
      maxBytes: 1024 * 1024,
      breaker: { failureThreshold: 1, coolDownMs: 60_000 },
    });
    const scan = fileScanHandler({
      db,
      storage,
      clamd: client,
      config: { MALWARE_SCAN_MODE: "required", CLAMAV_TIMEOUT_MS: 1000, SCAN_ERROR_MAX_RETRIES: 3 },
      flags: staticFlags(),
      metrics,
    });
    const attempt = async (n: number) => {
      const op = await enqueue(db, jobId, "file.scan", { fileId: file.id });
      return scan.run(handlerContext(op, { attempt: n })).catch((error: unknown) => error as TaskError);
    };
    expect(await attempt(1)).toMatchObject({ code: "scan_unavailable", retryable: true });
    expect(client.circuit).toBe("open");
    const fast = Date.now();
    expect(await attempt(2)).toMatchObject({ code: "scan_unavailable", retryable: true });
    expect(Date.now() - fast).toBeLessThan(500);
    let row = await fileRow(db, file.id);
    expect([row.scan_status, row.scan_attempts]).toEqual(["pending", 0]);
    // on the last attempt the open circuit is a scanner that could not be reached: the file is recorded as error
    expect(await attempt(3)).toMatchObject({ code: "scan_error", retryable: false });
    row = await fileRow(db, file.id);
    expect([row.scan_status, row.scan_attempts, row.scan_detail]).toEqual([
      "error",
      1,
      "The virus scanner could not be reached.",
    ]);
  });

  it("does not turn an aborted scan into an error on the file", async () => {
    const file = await insertFile(db, storage, jobId);
    const controller = new AbortController();
    controller.abort();
    const op = await enqueue(db, jobId, "file.scan", { fileId: file.id });
    await expect(handler().run(handlerContext(op, { signal: controller.signal }))).rejects.toThrow();
    expect((await fileRow(db, file.id)).scan_status).toBe("pending");
  });
});
