import { silentLog as log } from "../test/silent-log.js";
import { describe, expect, it } from "vitest";
import { runBackupJob, type BackupJobDeps } from "./backup-job.js";
import type { ObjectCopyResult } from "./object-copy.js";

const copyResult: ObjectCopyResult = { copied: 2, bytes: 10, vanished: 0, newlyMissing: 0, reappeared: 0, purged: 0 };

function setup(over: Partial<BackupJobDeps> = {}) {
  const calls: string[] = [];
  const deps: BackupJobDeps = {
    clock: { now: () => new Date("2026-10-09T18:15:00Z") },
    log,
    retentionDays: 35,
    dump: (key) => {
      calls.push(`dump ${key}`);
      return Promise.resolve({ size: 7, sha256: "ab" });
    },
    copyObjects: () => {
      calls.push("copy");
      return Promise.resolve(copyResult);
    },
    listDumps: () =>
      Promise.resolve([
        "db/nightly/20260801T181500Z.dump",
        "db/nightly/20261008T181500Z.dump",
        "db/pre-migrate/20260802T000000Z-v1.dump",
      ]),
    deleteDump: (key) => {
      calls.push(`delete ${key}`);
      return Promise.resolve();
    },
    ...over,
  };
  return { deps, calls };
}

describe("runBackupJob", () => {
  it("dumps to db/nightly/<utc>.dump, copies objects, then prunes old dumps", async () => {
    const { deps, calls } = setup();
    const summary = await runBackupJob(deps);
    expect(calls).toEqual(["dump db/nightly/20261009T181500Z.dump", "copy", "delete db/nightly/20260801T181500Z.dump"]);
    expect(summary).toEqual({
      ok: true,
      failures: [],
      dumpKey: "db/nightly/20261009T181500Z.dump",
      objects: copyResult,
      prunedDumps: 1,
    });
  });

  it("still copies objects when the dump fails, but does not prune", async () => {
    const { deps, calls } = setup({ dump: () => Promise.reject(new Error("pg_dump failed")) });
    const summary = await runBackupJob(deps);
    expect(calls).toEqual(["copy"]);
    expect(summary).toMatchObject({ ok: false, failures: ["database dump"], dumpKey: undefined, prunedDumps: 0 });
  });

  it("still dumps and prunes when the object copy fails", async () => {
    const { deps, calls } = setup({ copyObjects: () => Promise.reject(new Error("bucket down")) });
    const summary = await runBackupJob(deps);
    expect(calls[0]).toMatch(/^dump /);
    expect(calls).toContain("delete db/nightly/20260801T181500Z.dump");
    expect(summary).toMatchObject({ ok: false, failures: ["object copy"], objects: undefined });
  });

  it("reports every failing step, including retention", async () => {
    const { deps } = setup({
      dump: () => Promise.reject(new Error("a")),
      copyObjects: () => Promise.reject(new Error("b")),
    });
    expect((await runBackupJob(deps)).failures).toEqual(["database dump", "object copy"]);
    const pruneFails = setup({ deleteDump: () => Promise.reject(new Error("denied")) });
    expect(await runBackupJob(pruneFails.deps)).toMatchObject({
      ok: false,
      failures: ["dump retention"],
      prunedDumps: 0,
    });
  });
});
