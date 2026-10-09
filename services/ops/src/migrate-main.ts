/**
 * `migrate` Railway service entry point (skeleton). WP-04 implements: pg_dump to the backup bucket when migrations
 * are pending, apply migrations as tracker_migrator, then serve /healthz (200 only after success) so that
 * deploy-images.mjs can gate the api deploy on it; exit 1 on failure.
 */
import { createLogger } from "@kr/logger";
import { loadOpsConfig } from "./config.js";

const config = loadOpsConfig();
const log = createLogger({ service: "kr-ops-migrate", env: config.APP_ENV, level: config.LOG_LEVEL });
log.info({ event: "ops_migrate_skeleton" }, "Ops migrate skeleton started");
