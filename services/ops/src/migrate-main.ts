/**
 * `migrate` Railway service entry point (`start:migrate`, ADR-0007/0008). Takes a pg_dump into the backup bucket when
 * migrations are pending, applies them as tracker_migrator, then serves /healthz with 200 so the deploy script lets the
 * api start. Any failure logs the error and exits 1 without ever answering 200.
 */
import { createLogger } from "@kr/logger";
import { createS3Storage } from "@kr/storage";
import { loadOpsConfig } from "./config.js";
import { startMigrateService } from "./migrate-service.js";

const config = loadOpsConfig();
const log = createLogger({ service: "kr-ops-migrate", env: config.APP_ENV, level: config.LOG_LEVEL });
const storage = createS3Storage({
  endpoint: config.BACKUP_S3_ENDPOINT,
  region: config.BACKUP_S3_REGION,
  bucket: config.BACKUP_S3_BUCKET,
  accessKeyId: config.BACKUP_S3_ACCESS_KEY_ID,
  secretAccessKey: config.BACKUP_S3_SECRET_ACCESS_KEY,
  forcePathStyle: config.S3_FORCE_PATH_STYLE,
});

const service = await startMigrateService({ config, log, storage, clock: { now: () => new Date() } }).catch(
  (error: unknown) => {
    log.fatal({ event: "ops_migrate_start_failed", err: error }, "Migrate service could not start");
    return process.exit(1);
  },
);

const stop = (signal: string): void => {
  log.info({ event: "ops_migrate_stopping", signal }, "Stopping");
  void service.close().finally(() => {
    storage.close();
    process.exit(0);
  });
};
process.on("SIGTERM", () => {
  stop("SIGTERM");
});
process.on("SIGINT", () => {
  stop("SIGINT");
});

try {
  await service.done;
  log.info({ event: "ops_migrate_healthy" }, "Migrations succeeded: /healthz now answers 200");
} catch (error) {
  log.error({ event: "ops_migrate_failed", err: error }, "Migration failed: not serving 200");
  await service.close().catch(() => undefined);
  storage.close();
  process.exit(1);
}
