import { randomBytes } from "node:crypto";
import type { JobDetail } from "@kr/contracts";
import type { ApiSession } from "./api-client";

export interface NewJob {
  readonly jobNumber?: string;
  readonly address?: string;
  readonly clientName?: string | null;
  readonly subdivisionType?: string;
}

/** A job number no other test uses (job numbers are unique among active jobs). */
export function uniqueJobNumber(prefix = "E2E"): string {
  return `${prefix}-${randomBytes(3).toString("hex").toUpperCase()}`;
}

/** Create a synthetic job through the API as the given user (who needs `jobs.create`). */
export function createJob(session: ApiSession, job: NewJob = {}): Promise<JobDetail> {
  return session.post<JobDetail>("/v1/jobs", {
    jobNumber: job.jobNumber ?? uniqueJobNumber(),
    address: job.address ?? "12 Synthetic Street, Testville WA 6000",
    clientName: job.clientName === undefined ? "Synthetic Developments Pty Ltd" : job.clientName,
    subdivisionType: job.subdivisionType ?? "Survey-Strata",
  });
}

export function getJob(session: ApiSession, jobId: string): Promise<JobDetail> {
  return session.get<JobDetail>(`/v1/jobs/${jobId}`);
}

/** Change a checkpoint through the API (reads its current version for `If-Match`), as staff would from the tracker. */
export async function patchCheckpoint(
  session: ApiSession,
  jobId: string,
  key: string,
  change: { status?: "completed" | "not_completed" | "not_required"; responsibility?: string | null; krNote?: string },
): Promise<void> {
  const job = await getJob(session, jobId);
  const checkpoint = job.checkpoints.find((c) => c.key === key);
  if (!checkpoint) throw new Error(`No checkpoint ${key}`);
  await session.patch(`/v1/jobs/${jobId}/checkpoints/${key}`, change, `"${checkpoint.version.toString()}"`);
}
