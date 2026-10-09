/** Maps a job row plus its workflow summary to the dashboard card (the contract's JobCard). Pure. */
import type { JobCard } from "@kr/contracts";
import type { JobRow } from "@kr/db";
import { SUBDIVISION_TYPES, type JobSummary, type SubdivisionType } from "@kr/workflow";

export type CardJobRow = Pick<
  JobRow,
  "id" | "job_number" | "address" | "client_name" | "subdivision_type" | "updated_at"
>;

export function toSubdivisionType(value: string | null): SubdivisionType | null {
  if (value === null) return null;
  const known = SUBDIVISION_TYPES.find((t) => t === value);
  // The database CHECK keeps the list closed; anything else is a schema/workflow mismatch, never user input.
  if (!known) throw new RangeError(`Unknown subdivision type on a job: ${value}`);
  return known;
}

export function toJobCard(job: CardJobRow, summary: JobSummary): JobCard {
  return {
    id: job.id,
    jobNumber: job.job_number,
    address: job.address,
    clientName: job.client_name,
    subdivisionType: toSubdivisionType(job.subdivision_type),
    isComplete: summary.isComplete,
    progress: summary.progress,
    nextActions: [...summary.nextActions],
    alerts: [...summary.alerts],
    isWaitingOnClient: summary.isWaitingOnClient,
    updatedAt: job.updated_at.toISOString(),
  };
}
