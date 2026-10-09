import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ObjectStorage } from "@kr/storage";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { silentLog } from "../test/silent-log.js";
import { opsConfig, pgDump17, startS3Mock, type S3Mock } from "../test/support.js";
import { runBackup } from "./backup-service.js";
import { loadManifest } from "./manifest.js";

const FILES = "tracker-files-test";
const BACKUPS = "tracker-backups-test";
const DAY = 86_400_000;

let s3: S3Mock;
let files: ObjectStorage;
let backups: ObjectStorage;
let pgDumpPath: string;
let now = new Date("2026-10-09T18:15:00Z");

const run = (over: { pgDump?: string; source?: ObjectStorage } = {}) =>
  runBackup({
    config: opsConfig(
      { MIGRATION_DATABASE_URL: inject("migratorDatabaseUrl"), PG_DUMP_PATH: over.pgDump ?? pgDumpPath },
      s3,
      BACKUPS,
    ),
    log: silentLog,
    source: over.source ?? files,
    backup: backups,
    clock: { now: () => now },
  });

async function bytesOf(storage: ObjectStorage, key: string): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of (await storage.get(key)).body as AsyncIterable<Buffer>) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function keys(prefix: string): Promise<string[]> {
  const found: string[] = [];
  for await (const entry of backups.list(prefix)) found.push(entry.key);
  return found;
}

const sha256 = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");
const BIG = Buffer.alloc(9 * 1024 * 1024 + 123, 7); // larger than one 8 MiB multipart part

beforeAll(async () => {
  s3 = await startS3Mock([FILES, BACKUPS], BACKUPS);
  files = s3.open(FILES);
  backups = s3.storage;
  pgDumpPath = await pgDump17();
  await files.put({ key: "jobs/job-a/file-1", body: Buffer.from("%PDF- small"), contentType: "application/pdf" });
  await files.put({ key: "jobs/job-a/file-2", body: BIG, contentType: "application/octet-stream" });
  await files.put({ key: "jobs/job-b/file-3", body: Buffer.from("third"), contentType: "image/png" });
});

afterAll(async () => {
  await s3.stop();
});

describe("backup against real Postgres 17 and S3 buckets", () => {
  it("writes the nightly dump and copies every file under objects/, byte for byte", async () => {
    const summary = await run();
    expect(summary).toMatchObject({ ok: true, failures: [], dumpKey: "db/nightly/20261009T181500Z.dump" });
    expect(summary.objects).toMatchObject({ copied: 3, purged: 0 });

    const dump = await bytesOf(backups, "db/nightly/20261009T181500Z.dump");
    expect(dump.subarray(0, 5).toString()).toBe("PGDMP");
    expect(dump.includes("audit_events")).toBe(true);
    expect(sha256(await bytesOf(backups, "objects/jobs/job-a/file-2"))).toBe(sha256(BIG));
    expect(await bytesOf(backups, "objects/jobs/job-a/file-1")).toEqual(Buffer.from("%PDF- small"));
    expect((await backups.head("objects/jobs/job-b/file-3")).contentType).toBe("image/png");
    expect(Object.keys(await loadManifest(backups)).sort()).toEqual([
      "jobs/job-a/file-1",
      "jobs/job-a/file-2",
      "jobs/job-b/file-3",
    ]);
  });

  it("copies only new objects on the next night and writes a new dump", async () => {
    now = new Date(now.getTime() + DAY);
    await files.put({ key: "jobs/job-b/file-4", body: Buffer.from("fourth"), contentType: "text/plain" });
    const summary = await run();
    expect(summary.objects).toMatchObject({ copied: 1, bytes: 6 });
    expect(await keys("db/nightly/")).toEqual(["db/nightly/20261009T181500Z.dump", "db/nightly/20261010T181500Z.dump"]);
  });

  it("keeps the copy of a purged file for the retention period, then deletes it, and prunes old dumps", async () => {
    await files.delete("jobs/job-a/file-1");
    await backups.put({
      key: "db/pre-migrate/20260101T000000Z-v0.dump",
      body: Buffer.from("old"),
      contentType: "application/octet-stream",
    });
    await backups.put({
      key: "db/pre-migrate/20260102T000000Z-v1.dump",
      body: Buffer.from("old2"),
      contentType: "application/octet-stream",
    });

    now = new Date(now.getTime() + 2 * DAY);
    const gone = await run();
    expect(gone.objects).toMatchObject({ newlyMissing: 1, purged: 0 });
    expect(await backups.exists("objects/jobs/job-a/file-1")).toBe(true);

    now = new Date(now.getTime() + 36 * DAY);
    const later = await run();
    expect(later.objects).toMatchObject({ purged: 1 });
    expect(await backups.exists("objects/jobs/job-a/file-1")).toBe(false);
    expect(await backups.exists("objects/jobs/job-a/file-2")).toBe(true);
    expect(Object.keys(await loadManifest(backups))).not.toContain("jobs/job-a/file-1");

    // Dumps older than 35 days are pruned (35 is BACKUP_RETENTION_DAYS' default); the newest pre-migration dump stays.
    expect(await keys("db/nightly/")).toEqual(["db/nightly/20261117T181500Z.dump"]);
    expect(await keys("db/pre-migrate/")).toEqual(["db/pre-migrate/20260102T000000Z-v1.dump"]);
    expect(gone.prunedDumps).toBe(1); // the January pre-migration dump, already 9 months old on the first run
    expect(later.prunedDumps).toBe(3); // the three nightly dumps of October
  });

  it("still copies the files, keeps every dump and reports failure when pg_dump fails", async () => {
    now = new Date(now.getTime() + DAY);
    const failing = join(tmpdir(), `kr-ops-failing-pg-dump-${process.pid}`);
    await writeFile(failing, '#!/bin/sh\necho "pg_dump: error: server closed the connection" >&2\nexit 1\n', {
      mode: 0o755,
    });
    await files.put({ key: "jobs/job-c/file-5", body: Buffer.from("fifth"), contentType: "text/plain" });
    const before = await keys("db/");
    const summary = await run({ pgDump: failing });
    expect(summary).toMatchObject({ ok: false, failures: ["database dump"], dumpKey: undefined, prunedDumps: 0 });
    expect(summary.objects).toMatchObject({ copied: 1 });
    expect(await keys("db/")).toEqual(before);
  });

  it("still writes the dump and reports failure when the files bucket cannot be read", async () => {
    now = new Date(now.getTime() + DAY);
    const unreadable: ObjectStorage = {
      ...files,
      list: () => ({ [Symbol.asyncIterator]: () => ({ next: () => Promise.reject(new Error("AccessDenied")) }) }),
    };
    const summary = await run({ source: unreadable });
    expect(summary).toMatchObject({ ok: false, failures: ["object copy"] });
    expect(summary.dumpKey).toBe("db/nightly/20261119T181500Z.dump");
    expect(await backups.exists("db/nightly/20261119T181500Z.dump")).toBe(true);
  });
});
