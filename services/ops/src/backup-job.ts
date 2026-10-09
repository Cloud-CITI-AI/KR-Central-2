/**
 * The nightly `backup` job: database dump, incremental object copy, then dump retention. The steps are independent: a
 * failed dump does not stop the object copy and a failed copy does not stop the dump, but pruning only runs after a
 * successful dump (never shrink the recovery points while the newest one is missing). The result says whether to exit 0 or 1.
 */
import type { Logger } from "@kr/logger";
import { NIGHTLY_PREFIX, PRE_MIGRATE_PREFIX, nightlyKey } from "./domain/keys.js";
import { planDumpPruning } from "./domain/dump-retention.js";
import type { Clock } from "./migrate-job.js";
import type { ObjectCopyResult } from "./object-copy.js";

export interface BackupJobDeps {
  readonly clock: Clock;
  readonly log: Logger;
  readonly retentionDays: number;
  readonly dump: (key: string) => Promise<{ readonly size: number; readonly sha256: string }>;
  readonly copyObjects: () => Promise<ObjectCopyResult>;
  /** Keys of every dump in the backup bucket (both prefixes). */
  readonly listDumps: () => Promise<readonly string[]>;
  readonly deleteDump: (key: string) => Promise<void>;
}

export interface BackupSummary {
  readonly ok: boolean;
  readonly failures: readonly string[];
  readonly dumpKey: string | undefined;
  readonly objects: ObjectCopyResult | undefined;
  readonly prunedDumps: number;
}

export const DUMP_PREFIXES = [NIGHTLY_PREFIX, PRE_MIGRATE_PREFIX] as const;

export async function runBackupJob(deps: BackupJobDeps): Promise<BackupSummary> {
  const { log } = deps;
  const failures: string[] = [];
  const fail = (step: string, error: unknown): void => {
    failures.push(step);
    log.error({ event: "ops_backup_step_failed", step, err: error }, `Backup step failed: ${step}`);
  };

  let dumpKey: string | undefined;
  try {
    const key = nightlyKey(deps.clock.now());
    const stored = await deps.dump(key);
    dumpKey = key;
    log.info(
      { event: "ops_backup_dump_stored", key, bytes: stored.size, sha256: stored.sha256 },
      "Nightly dump stored",
    );
  } catch (error) {
    fail("database dump", error);
  }

  let objects: ObjectCopyResult | undefined;
  try {
    objects = await deps.copyObjects();
    log.info({ event: "ops_backup_objects_copied", ...objects }, "Object copy finished");
  } catch (error) {
    fail("object copy", error);
  }

  let prunedDumps = 0;
  if (dumpKey !== undefined) {
    try {
      const plan = planDumpPruning(await deps.listDumps(), deps.clock.now(), deps.retentionDays);
      if (plan.unrecognised.length > 0) {
        log.warn(
          { event: "ops_backup_dump_unrecognised", keys: plan.unrecognised },
          "Dump keys without a UTC stamp were left alone",
        );
      }
      for (const key of plan.delete) {
        await deps.deleteDump(key);
        prunedDumps += 1;
      }
      log.info({ event: "ops_backup_dumps_pruned", count: prunedDumps }, "Old dumps pruned");
    } catch (error) {
      fail("dump retention", error);
    }
  }
  return { ok: failures.length === 0, failures, dumpKey, objects, prunedDumps };
}
