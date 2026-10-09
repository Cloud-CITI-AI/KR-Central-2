/**
 * The `migrate` job's order of work (ADR-0007/0008): find pending migrations; if there are any, store a pg_dump first
 * (the recovery point for a bad migration); then apply. A failed dump aborts before anything is changed. The functions
 * that touch Postgres, pg_dump and the bucket are injected, so this ordering is tested without them.
 */
import type { Logger } from "@kr/logger";
import { preMigrateKey } from "./domain/keys.js";

export interface Clock {
  now(): Date;
}

export interface MigrateJobDeps {
  readonly release: string;
  readonly clock: Clock;
  readonly log: Logger;
  /** File names of migrations not yet applied, in order. */
  readonly findPending: () => Promise<readonly string[]>;
  /** Writes the pre-migration dump under `key` and resolves with what was stored. */
  readonly backup: (key: string) => Promise<{ readonly size: number; readonly sha256: string }>;
  /** Applies pending migrations as tracker_migrator; resolves with the file names applied. */
  readonly apply: () => Promise<readonly string[]>;
}

export interface MigrateOutcome {
  readonly pending: readonly string[];
  /** Absent when nothing was pending, so no dump was taken. */
  readonly backupKey: string | undefined;
  readonly applied: readonly string[];
}

export async function runMigrationJob(deps: MigrateJobDeps): Promise<MigrateOutcome> {
  const { log } = deps;
  const pending = await deps.findPending();
  let backupKey: string | undefined;
  if (pending.length === 0) {
    log.info({ event: "ops_migrate_nothing_pending" }, "No pending migrations: no dump taken");
  } else {
    log.info({ event: "ops_migrate_pending", count: pending.length, migrations: pending }, "Pending migrations found");
    backupKey = preMigrateKey(deps.clock.now(), deps.release);
    const stored = await deps.backup(backupKey);
    log.info(
      { event: "ops_migrate_backup_stored", key: backupKey, bytes: stored.size, sha256: stored.sha256 },
      "Pre-migration dump stored",
    );
  }
  // Also runs with nothing pending: it re-checks the checksums of applied files, so an edited migration fails the deploy.
  const applied = await deps.apply();
  log.info({ event: "ops_migrate_applied", count: applied.length, migrations: applied }, "Migrations applied");
  return { pending, backupKey, applied };
}
