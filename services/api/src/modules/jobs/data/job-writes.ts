/** Job inserts (BE-7: Kysely only). Callers pass the transaction that also writes the audit row. */
import type { Database, JobRow } from "@kr/db";
import { CHECKPOINTS } from "@kr/workflow";
import type { Transaction } from "kysely";
import { ConflictError } from "../../../platform/errors.js";

const JOB_NUMBER_KEY = "jobs_job_number_active_key";

/** A unique-index violation on the active job number (R15: unique among non-archived jobs, case-insensitive). */
export function isDuplicateJobNumber(error: unknown): boolean {
  const e = error as { code?: unknown; constraint?: unknown } | null;
  return typeof e === "object" && e !== null && e.code === "23505" && e.constraint === JOB_NUMBER_KEY;
}

export function duplicateJobNumberError(jobNumber: string): ConflictError {
  return new ConflictError({ detail: `${jobNumber} is already in use.` });
}

export interface NewJobValues {
  readonly jobNumber: string;
  readonly address: string;
  readonly clientName: string | null;
  readonly subdivisionType: string;
}

/**
 * Insert the job and ALL its checkpoint_states (default responsibilities, R3) in the caller's transaction: files point
 * at checkpoint_states through `files_checkpoint_fk`, so a job without its 46 rows could not accept an upload.
 */
export async function insertJobWithCheckpoints(
  trx: Transaction<Database>,
  createdBy: string,
  values: NewJobValues,
): Promise<JobRow> {
  const taken = await trx
    .selectFrom("jobs")
    .select("id")
    .where("job_number", "=", values.jobNumber)
    .where("deleted_at", "is", null)
    .executeTakeFirst();
  if (taken) throw duplicateJobNumberError(values.jobNumber);
  let job: JobRow;
  try {
    job = await trx
      .insertInto("jobs")
      .values({
        job_number: values.jobNumber,
        address: values.address,
        client_name: values.clientName,
        subdivision_type: values.subdivisionType,
        created_by: createdBy,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  } catch (error) {
    // Two requests can pass the check above together; the partial unique index decides.
    if (isDuplicateJobNumber(error)) throw duplicateJobNumberError(values.jobNumber);
    throw error;
  }
  await trx
    .insertInto("checkpoint_states")
    .values(
      CHECKPOINTS.map((c) => ({ job_id: job.id, checkpoint_key: c.key, responsibility: c.defaultResponsibility })),
    )
    .execute();
  return job;
}
