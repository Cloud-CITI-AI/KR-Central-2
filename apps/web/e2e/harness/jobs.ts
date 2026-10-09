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
