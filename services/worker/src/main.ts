/**
 * Worker entry point (skeleton). WP-07 replaces this with the operations poller, handlers and health endpoint.
 */
import { createLogger } from "@kr/logger";
import { loadWorkerConfig } from "./config.js";

const config = loadWorkerConfig();
const log = createLogger({ service: "kr-worker", env: config.APP_ENV, level: config.LOG_LEVEL });
log.info({ event: "worker_started", concurrency: config.WORKER_CONCURRENCY }, "Worker skeleton started");
