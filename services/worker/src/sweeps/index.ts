/** The sweep tasks the worker runs every hour, in this order. */
import type { Db } from "@kr/db";
import type { Logger } from "@kr/logger";
import type { ObjectStorage } from "@kr/storage";
import { deleteExpiredRows, purgeDeletedFiles, requeueStuckScans, rescanErroredFiles } from "../data/sweeps.js";
import { jobsWithDuePushes, queuePush } from "../data/teams.js";
import { PUSH_MAX_ATTEMPTS } from "../handlers/teams-push.js";
import type { SweepTask } from "./runner.js";

export interface SweepDeps {
  readonly db: Db;
  readonly storage: ObjectStorage;
  readonly log: Logger;
  /** SCAN_ERROR_MAX_RETRIES */
  readonly maxScanRetries: number;
  /** `teams-file-sync`: the retry sweep runs only while the integration exists (ADR-0015). */
  readonly teamsEnabled?: boolean;
}

/** Queues `teams.push` for every linked job with copies still due (failed copies retry here, decision 9). */
export async function requeueDuePushes(db: Db): Promise<{ jobsRequeued: number }> {
  const jobs = await jobsWithDuePushes(db, PUSH_MAX_ATTEMPTS);
  for (const jobId of jobs) await queuePush(db, jobId);
  return { jobsRequeued: jobs.length };
}

export function buildSweepTasks(deps: SweepDeps): SweepTask[] {
  return [
    { name: "purge_files", run: (c) => purgeDeletedFiles(deps.db, deps.storage, c, deps.log) },
    { name: "expired_rows", run: (c) => deleteExpiredRows(deps.db, c) },
    // rescans before stuck scans: a file just put back to `pending` has a scan queued, so it is not "stuck"
    { name: "rescan_errors", run: () => rescanErroredFiles(deps.db, deps.maxScanRetries) },
    { name: "requeue_stuck_scans", run: (c) => requeueStuckScans(deps.db, c, deps.log) },
    ...(deps.teamsEnabled ? [{ name: "teams_push_retry", run: () => requeueDuePushes(deps.db) }] : []),
  ];
}
