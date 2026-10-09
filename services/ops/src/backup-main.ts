/**
 * `backup` Railway cron service entry point (skeleton). WP-04 implements: nightly pg_dump plus an incremental copy of
 * the files bucket into the backup bucket, then retention pruning; exits 0/1 (Railway cron).
 */
import { createLogger } from "@kr/logger";
import { loadOpsConfig } from "./config.js";

const config = loadOpsConfig();
const log = createLogger({ service: "kr-ops-backup", env: config.APP_ENV, level: config.LOG_LEVEL });
log.info({ event: "ops_backup_skeleton" }, "Ops backup skeleton started");
