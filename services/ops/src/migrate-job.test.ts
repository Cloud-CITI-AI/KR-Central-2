import { createLogger } from "@kr/logger";
import { describe, expect, it, vi } from "vitest";
import { runMigrationJob, type MigrateJobDeps } from "./migrate-job.js";

const silent = createLogger({ service: "test", env: "local", level: "error" });
const clock = { now: () => new Date("2026-10-09T07:01:02Z") };

function deps(overrides: Partial<MigrateJobDeps> = {}): { deps: MigrateJobDeps; calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    deps: {
      release: "v1.2.3",
      clock,
      log: silent,
      findPending: () => {
        calls.push("findPending");
        return Promise.resolve(["0002_add_x.sql", "0003_add_y.sql"]);
      },
      backup: (key) => {
        calls.push(`backup ${key}`);
        return Promise.resolve({ size: 42, sha256: "ab" });
      },
      apply: () => {
        calls.push("apply");
        return Promise.resolve(["0002_add_x.sql", "0003_add_y.sql"]);
      },
      ...overrides,
    },
  };
}

describe("runMigrationJob", () => {
  it("dumps to db/pre-migrate/<utc>-<release>.dump before it applies pending migrations", async () => {
    const { deps: d, calls } = deps();
    const outcome = await runMigrationJob(d);
    expect(calls).toEqual(["findPending", "backup db/pre-migrate/20261009T070102Z-v1.2.3.dump", "apply"]);
    expect(outcome).toEqual({
      pending: ["0002_add_x.sql", "0003_add_y.sql"],
      backupKey: "db/pre-migrate/20261009T070102Z-v1.2.3.dump",
      applied: ["0002_add_x.sql", "0003_add_y.sql"],
    });
  });

  it("takes no dump when nothing is pending, but still runs the runner (checksum check)", async () => {
    const { deps: d, calls } = deps({ findPending: () => Promise.resolve([]), apply: () => Promise.resolve([]) });
    const outcome = await runMigrationJob(d);
    expect(calls).toEqual([]);
    expect(outcome).toEqual({ pending: [], backupKey: undefined, applied: [] });
  });

  it("does not touch the schema when the dump fails", async () => {
    const apply = vi.fn(() => Promise.resolve([]));
    const { deps: d } = deps({ backup: () => Promise.reject(new Error("bucket unreachable")), apply });
    await expect(runMigrationJob(d)).rejects.toThrow("bucket unreachable");
    expect(apply).not.toHaveBeenCalled();
  });

  it("rejects when the migration fails, after the dump was stored", async () => {
    const { deps: d, calls } = deps({ apply: () => Promise.reject(new Error("Migration 0003 failed")) });
    await expect(runMigrationJob(d)).rejects.toThrow("Migration 0003 failed");
    expect(calls[1]).toMatch(/^backup /);
  });

  it("rejects when the pending check fails, before any dump", async () => {
    const backup = vi.fn(() => Promise.resolve({ size: 1, sha256: "" }));
    const { deps: d } = deps({ findPending: () => Promise.reject(new Error("connection refused")), backup });
    await expect(runMigrationJob(d)).rejects.toThrow("connection refused");
    expect(backup).not.toHaveBeenCalled();
  });
});
