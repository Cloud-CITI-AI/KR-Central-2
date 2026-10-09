/**
 * `backup` Railway cron service entry point (`node dist/backup-main.js`, daily 18:15 UTC, ADR-0008): nightly pg_dump,
 * incremental copy of the files bucket, retention pruning. Exits 0 when every step succeeded and 1 otherwise; logs are
 * structured JSON only.
 */
import { ConfigError } from "@kr/config";
import { createLogger } from "@kr/logger";
import { createS3Storage } from "@kr/storage";
import { runBackup } from "./backup-service.js";
import { loadOpsConfig, requireSourceBucket } from "./config.js";

const config = loadOpsConfig();
const log = createLogger({ service: "kr-ops-backup", env: config.APP_ENV, level: config.LOG_LEVEL });

let sourceBucket;
try {
  sourceBucket = requireSourceBucket(config);
} catch (error) {
  if (!(error instanceof ConfigError)) throw error;
  log.fatal({ event: "config_invalid", variables: error.variables }, "The files bucket is not configured");
  process.exit(1);
}

const source = createS3Storage(sourceBucket);
const backup = createS3Storage({
  endpoint: config.BACKUP_S3_ENDPOINT,
  region: config.BACKUP_S3_REGION,
  bucket: config.BACKUP_S3_BUCKET,
  accessKeyId: config.BACKUP_S3_ACCESS_KEY_ID,
  secretAccessKey: config.BACKUP_S3_SECRET_ACCESS_KEY,
  forcePathStyle: config.S3_FORCE_PATH_STYLE,
});

let ok = false;
try {
  const summary = await runBackup({ config, log, source, backup, clock: { now: () => new Date() } });
  ok = summary.ok;
  log.info(
    {
      event: summary.ok ? "ops_backup_finished" : "ops_backup_failed",
      failures: summary.failures,
      dumpKey: summary.dumpKey,
    },
    summary.ok ? "Backup finished" : "Backup finished with failures",
  );
} catch (error) {
  log.error({ event: "ops_backup_failed", err: error }, "Backup could not run");
} finally {
  source.close();
  backup.close();
}
process.exit(ok ? 0 : 1);
