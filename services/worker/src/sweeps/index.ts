/** The sweep tasks the worker runs every hour, in this order. */
import type { Db } from "@kr/db";
import type { Logger } from "@kr/logger";
import type { ObjectStorage } from "@kr/storage";
import { deleteExpiredRows, purgeDeletedFiles, requeueStuckScans, rescanErroredFiles } from "../data/sweeps.js";
import type { SweepTask } from "./runner.js";

export interface SweepDeps {
  readonly db: Db;
  readonly storage: ObjectStorage;
  readonly log: Logger;
  /** SCAN_ERROR_MAX_RETRIES */
  readonly maxScanRetries: number;
}

export function buildSweepTasks(deps: SweepDeps): SweepTask[] {
  return [
    { name: "purge_files", run: (c) => purgeDeletedFiles(deps.db, deps.storage, c, deps.log) },
    { name: "expired_rows", run: (c) => deleteExpiredRows(deps.db, c) },
    // rescans before stuck scans: a file just put back to `pending` has a scan queued, so it is not "stuck"
    { name: "rescan_errors", run: () => rescanErroredFiles(deps.db, deps.maxScanRetries) },
    { name: "requeue_stuck_scans", run: (c) => requeueStuckScans(deps.db, c) },
  ];
}
