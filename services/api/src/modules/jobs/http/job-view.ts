/** Response mapping for the job routes: load a job's rows and render the viewer's view of them. */
import type { JobDetail } from "@kr/contracts";
import type { Database } from "@kr/db";
import type { Kysely } from "kysely";
import { NotFoundError } from "../../../platform/errors.js";
import { loadJobParts } from "../data/job-parts.js";
import { buildJobDetail, type JobViewer } from "../domain/job-detail.js";
import { canViewFeeProposal } from "../domain/rule-input.js";

export type { JobViewer } from "../domain/job-detail.js";

/** The tracker view of one job; 404 when the job was archived meanwhile. */
export async function loadJobDetail(
  db: Kysely<Database>,
  jobId: string,
  viewer: JobViewer,
  now: Date,
): Promise<JobDetail> {
  const parts = await loadJobParts(db, jobId, canViewFeeProposal(viewer.capabilities));
  if (!parts) throw new NotFoundError();
  return buildJobDetail(parts, viewer, now);
}
