import { randomBytes } from "node:crypto";
import type { JobDetail, Operation } from "@kr/contracts";
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

/** The id of the first file in a checkpoint's slot (the files a test uploaded through the browser). */
export async function firstFileId(session: ApiSession, jobId: string, checkpointKey: string): Promise<string> {
  const job = await getJob(session, jobId);
  const file = job.checkpoints.find((c) => c.key === checkpointKey)?.files[0];
  if (!file) throw new Error(`No file in ${checkpointKey}`);
  return file.id;
}

/** Poll an operation until the worker has finished it (the UI does the same, 1 s apart). */
export async function waitForOperation(
  session: ApiSession,
  operationId: string,
  timeoutMs = 60_000,
): Promise<Operation> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const operation = await session.get<Operation>(`/v1/operations/${operationId}`);
    if (operation.status === "succeeded" || operation.status === "failed") return operation;
    if (Date.now() > deadline)
      throw new Error(`Operation ${operationId} still ${operation.status} after ${timeoutMs.toString()} ms`);
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
}

/** Give a person access to a job through the API (as staff would from the access manager). The grant is pending until they sign in. */
export function grantAccess(
  session: ApiSession,
  grant: { jobId: string; email: string; role: "client" | "architect"; displayName?: string },
): Promise<{ id: string; status: string }> {
  return session.post("/v1/access-grants", grant);
}
