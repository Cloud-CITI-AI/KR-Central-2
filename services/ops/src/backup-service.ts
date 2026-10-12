/**
 * Wires the `backup` Railway cron job: the real dump, object copy and dump listing/deletion around runBackupJob.
 * Nothing here reads process.env (config.ts does).
 */
import type { Logger } from "@kr/logger";
import type { ObjectStorage } from "@kr/storage";
import { DUMP_PREFIXES, runBackupJob, type BackupSummary } from "./backup-job.js";
import type { BackupConfig } from "./config.js";
import type { Clock } from "./migrate-job.js";
import { copyObjects } from "./object-copy.js";
import { dumpToStorage } from "./pg-dump.js";

export interface BackupServiceDeps {
  readonly config: BackupConfig;
  readonly log: Logger;
  /** The files bucket, read only. */
  readonly source: Pick<ObjectStorage, "list" | "get">;
  /** The backup bucket. */
  readonly backup: Pick<ObjectStorage, "list" | "get" | "put" | "head" | "delete">;
  readonly clock: Clock;
}

export function runBackup(deps: BackupServiceDeps): Promise<BackupSummary> {
  const { config, log, backup } = deps;
  return runBackupJob({
    clock: deps.clock,
    log,
    retentionDays: config.BACKUP_RETENTION_DAYS,
    dump: (key) =>
      dumpToStorage({
        storage: backup,
        key,
        pgDumpPath: config.PG_DUMP_PATH,
        databaseUrl: config.BACKUP_DATABASE_URL,
        ssl: config.DATABASE_SSL,
      }),
    copyObjects: () =>
      copyObjects({
        source: deps.source,
        backup,
        clock: deps.clock,
        log,
        retentionDays: config.BACKUP_RETENTION_DAYS,
      }),
    listDumps: async () => {
      const keys: string[] = [];
      for (const prefix of DUMP_PREFIXES) for await (const entry of backup.list(prefix)) keys.push(entry.key);
      return keys;
    },
    deleteDump: (key) => backup.delete(key),
  });
}
