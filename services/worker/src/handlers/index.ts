/** The handlers this worker runs, by operation type. Each PR of WP-12 adds its own entry here. */
import type { Db } from "@kr/db";
import type { ObjectStorage } from "@kr/storage";
import type { KrMetrics } from "@kr/telemetry";
import type { ClamdClient } from "../clients/clamd.js";
import type { WorkerConfig } from "../config.js";
import { fileScanHandler } from "./file-scan.js";
import type { Handlers } from "./types.js";

export interface HandlerDeps {
  readonly db: Db;
  readonly storage: ObjectStorage;
  readonly clamd: ClamdClient;
  readonly config: WorkerConfig;
  readonly metrics: KrMetrics;
}

export function buildHandlers(deps: HandlerDeps): Handlers {
  return { "file.scan": fileScanHandler(deps) };
}
