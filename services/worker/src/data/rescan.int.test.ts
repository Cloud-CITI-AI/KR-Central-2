import type { Db } from "@kr/db";
import { createMemoryStorage } from "@kr/storage/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { enqueue, insertJob, openDb } from "../../test/db.js";
import { insertFile } from "../../test/files.js";
import { captureLog } from "../../test/log.js";
import { cutoffs } from "../domain/retention.js";
import { requeueStuckScans, rescanErroredFiles } from "./sweeps.js";

const NOW = new Date();
let db: Db;
let jobId: string;
const storage = createMemoryStorage();
beforeAll(async () => {
  db = openDb();
  jobId = await insertJob(db);
});
afterAll(async () => {
  await db.destroy();
});
beforeEach(async () => {
  jobId = await insertJob(db); // a fresh job: the shared database keeps files of other tests
  await db.deleteFrom("operations").execute();
  // files of other tests are out of scope for these cases
  await db
    .updateTable("files")
    .set({ scan_status: "clean" })
    .where("scan_status", "in", ["pending", "error"])
    .execute();
});

const scans = () => db.selectFrom("operations").select(["status", "payload"]).where("type", "=", "file.scan").execute();
const status = (id: string) =>
  db
    .selectFrom("files")
    .select("scan_status")
    .where("id", "=", id)
    .executeTakeFirstOrThrow()
    .then((r) => r.scan_status);

describe("rescanErroredFiles", () => {
  it("scans again a file in error that failed 1 to 3 times, putting it back to pending, and leaves one that failed a fourth time", async () => {
    const files = await Promise.all(
      [1, 2, 3, 4].map((n) => insertFile(db, storage, jobId, { scanStatus: "error", scanAttempts: n })),
    );
    expect(await rescanErroredFiles(db, 3)).toEqual({ requeued: 3, exhausted: 1 });
    expect(await Promise.all(files.map((f) => status(f.id)))).toEqual(["pending", "pending", "pending", "error"]);
    const queued = (await scans()).map((r) => (r.payload as { fileId: string }).fileId).sort();
    expect(queued).toEqual(
      files
        .slice(0, 3)
        .map((f) => f.id)
        .sort(),
    );
  });

  it("skips a file that already has a scan queued or running, a deleted file, and does not queue twice", async () => {
    const queued = await insertFile(db, storage, jobId, { scanStatus: "error", scanAttempts: 1 });
    await enqueue(db, jobId, "file.scan", { fileId: queued.id });
    const deleted = await insertFile(db, storage, jobId, { scanStatus: "error", scanAttempts: 1 });
    await db.updateTable("files").set({ deleted_at: NOW }).where("id", "=", deleted.id).execute();
    const due = await insertFile(db, storage, jobId, { scanStatus: "error", scanAttempts: 2 });
    expect((await rescanErroredFiles(db, 3)).requeued).toBe(1);
    expect((await rescanErroredFiles(db, 3)).requeued).toBe(0);
    expect(await scans()).toHaveLength(2);
    expect(await Promise.all([queued, deleted, due].map((f) => status(f.id)))).toEqual(["error", "error", "pending"]);
  });

  it("does not rescan at all when no retries are allowed", async () => {
    const f = await insertFile(db, storage, jobId, { scanStatus: "error", scanAttempts: 1 });
    expect(await rescanErroredFiles(db, 0)).toEqual({ requeued: 0, exhausted: 1 });
    expect(await status(f.id)).toBe("error");
  });
});

describe("requeueStuckScans", () => {
  const upload = (id: string, minutesAgo: number) =>
    db
      .updateTable("files")
      .set({ uploaded_at: new Date(NOW.getTime() - minutesAgo * 60_000) })
      .where("id", "=", id)
      .execute();

  it("queues a scan for a file pending for over 15 minutes with no scan, and only that", async () => {
    const stuck = await insertFile(db, storage, jobId, { scanStatus: "pending" });
    await upload(stuck.id, 20);
    const fresh = await insertFile(db, storage, jobId, { scanStatus: "pending" });
    await upload(fresh.id, 5);
    const waiting = await insertFile(db, storage, jobId, { scanStatus: "pending" });
    await upload(waiting.id, 60);
    await enqueue(db, jobId, "file.scan", { fileId: waiting.id });
    const failedBefore = await insertFile(db, storage, jobId, { scanStatus: "pending" });
    await upload(failedBefore.id, 60);
    const op = await enqueue(db, jobId, "file.scan", { fileId: failedBefore.id });
    await db.updateTable("operations").set({ status: "failed" }).where("id", "=", op.id).execute();

    expect(await requeueStuckScans(db, cutoffs(NOW), captureLog().log)).toEqual({ requeued: 2, stalled: 0 });
    const queued = (await scans())
      .filter((r) => r.status === "queued")
      .map((r) => (r.payload as { fileId: string }).fileId);
    expect(queued.sort()).toEqual([waiting.id, stuck.id, failedBefore.id].sort());
    expect((await requeueStuckScans(db, cutoffs(NOW), captureLog().log)).requeued).toBe(0);
  });

  it("raises an error-level alert, with ids only, for a file still pending after 24 hours even though scans are queued for it", async () => {
    const forever = await insertFile(db, storage, jobId, { scanStatus: "pending" });
    await upload(forever.id, 25 * 60);
    await enqueue(db, jobId, "file.scan", { fileId: forever.id }); // a scan is queued: the file is not "stuck", it is late
    const late = await insertFile(db, storage, jobId, { scanStatus: "pending" });
    await upload(late.id, 23 * 60);
    const gone = await insertFile(db, storage, jobId, { scanStatus: "pending" });
    await upload(gone.id, 30 * 60);
    await db.updateTable("files").set({ deleted_at: NOW }).where("id", "=", gone.id).execute();

    const captured = captureLog();
    const report = await requeueStuckScans(db, cutoffs(NOW), captured.log);
    expect(report).toEqual({ requeued: 1, stalled: 1 }); // `late` is stuck, not yet an alert
    const alert = captured.lines.filter((l) => l.event === "scan_pending_too_long");
    expect(alert).toHaveLength(1);
    expect(alert[0]).toMatchObject({ level: "error", stalled: 1, fileIds: [forever.id] });
    expect(JSON.stringify(alert[0])).not.toContain("Decision Letter");
  });

  it("stays quiet when no file has waited that long", async () => {
    const f = await insertFile(db, storage, jobId, { scanStatus: "pending" });
    await upload(f.id, 60);
    const captured = captureLog();
    expect((await requeueStuckScans(db, cutoffs(NOW), captured.log)).stalled).toBe(0);
    expect(captured.events()).toEqual([]);
  });
});
