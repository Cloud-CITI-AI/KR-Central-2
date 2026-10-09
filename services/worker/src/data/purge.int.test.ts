import type { Db } from "@kr/db";
import type { ObjectStorage } from "@kr/storage";
import { createMemoryStorage } from "@kr/storage/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { insertJob, openDb } from "../../test/db.js";
import { insertFile } from "../../test/files.js";
import { captureLog } from "../../test/log.js";
import { cutoffs } from "../domain/retention.js";
import { purgeDeletedFiles } from "./sweeps.js";

const NOW = new Date("2026-10-09T08:00:00.000Z");
const daysAgo = (n: number): Date => new Date(NOW.getTime() - n * 86_400_000);

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
  // files soft-deleted by other test files in the shared database are not part of these cases
  await db
    .updateTable("files")
    .set({ purged_at: new Date() })
    .where("deleted_at", "is not", null)
    .where("purged_at", "is", null)
    .execute();
});

const deleted = (id: string, at: Date | null) =>
  db.updateTable("files").set({ deleted_at: at }).where("id", "=", id).execute();
const row = (id: string) =>
  db.selectFrom("files").select(["purged_at", "deleted_at"]).where("id", "=", id).executeTakeFirstOrThrow();

describe("purgeDeletedFiles", () => {
  it("purges the objects of files deleted more than 30 days ago, marks them and audits it as the system", async () => {
    const storage = createMemoryStorage();
    const old = await insertFile(db, storage, jobId, { scanStatus: "clean" });
    const recent = await insertFile(db, storage, jobId, { scanStatus: "clean" });
    const live = await insertFile(db, storage, jobId, { scanStatus: "clean" });
    await deleted(old.id, daysAgo(31));
    await deleted(recent.id, daysAgo(29));
    const result = await purgeDeletedFiles(db, storage, cutoffs(NOW), captureLog().log);
    expect(result).toEqual({ purged: 1, failed: 0 });
    expect((await row(old.id)).purged_at).toEqual(NOW);
    expect(await storage.exists(old.key)).toBe(false);
    expect((await row(recent.id)).purged_at).toBeNull();
    expect((await row(live.id)).purged_at).toBeNull();
    for (const kept of [recent, live]) expect(await storage.exists(kept.key)).toBe(true);
    const audit = await db.selectFrom("audit_events").selectAll().where("entity_id", "=", old.id).execute();
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actor_type: "system", action: "file.purged", job_id: jobId, changes: null });
  });

  it("does nothing a second time, and tolerates an object that is already gone", async () => {
    const storage = createMemoryStorage();
    const gone = await insertFile(db, storage, jobId, { noObject: true });
    await deleted(gone.id, daysAgo(40));
    expect((await purgeDeletedFiles(db, storage, cutoffs(NOW), captureLog().log)).purged).toBe(1);
    expect(await purgeDeletedFiles(db, storage, cutoffs(NOW), captureLog().log)).toEqual({ purged: 0, failed: 0 });
  });

  it("skips a file whose object cannot be deleted, purges the others and retries the failed one next sweep", async () => {
    const memory = createMemoryStorage();
    const stuck = await insertFile(db, memory, jobId);
    const fine = await insertFile(db, memory, jobId);
    for (const f of [stuck, fine]) await deleted(f.id, daysAgo(35));
    const flaky: ObjectStorage = {
      ...memory,
      delete: (key) => (key === stuck.key ? Promise.reject(new Error("bucket unavailable")) : memory.delete(key)),
    };
    const { log, events } = captureLog();
    expect(await purgeDeletedFiles(db, flaky, cutoffs(NOW), log)).toEqual({ purged: 1, failed: 1 });
    expect(events()).toContain("purge_failed");
    expect((await row(stuck.id)).purged_at).toBeNull();
    expect(await memory.exists(stuck.key)).toBe(true);
    expect((await row(fine.id)).purged_at).toEqual(NOW);
    expect(await purgeDeletedFiles(db, memory, cutoffs(NOW), captureLog().log)).toEqual({ purged: 1, failed: 0 });
    expect(await memory.exists(stuck.key)).toBe(false);
  });
});
