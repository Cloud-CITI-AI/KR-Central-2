/** Versioned job writes (DATA_MODEL §6: `UPDATE … SET …, version = version + 1 WHERE id = $1 AND version = $2`). */
import type { Database, JobRow } from "@kr/db";
import type { Transaction } from "kysely";
import { NotFoundError, PreconditionFailedError } from "../../../platform/errors.js";
import type { JobUpdateColumns } from "../domain/job-update.js";
import { duplicateJobNumberError, isDuplicateJobNumber } from "./job-writes.js";

export function staleJobError(): PreconditionFailedError {
  return new PreconditionFailedError({ detail: "This item was changed by someone else. Reload and try again." });
}

/** The job row, locked for the rest of the transaction; undefined when it does not exist or is archived. */
export function lockActiveJob(trx: Transaction<Database>, jobId: string): Promise<JobRow | undefined> {
  return trx
    .selectFrom("jobs")
    .selectAll()
    .where("id", "=", jobId)
    .where("deleted_at", "is", null)
    .forUpdate()
    .executeTakeFirst();
}

/** Apply `set` and bump the version; 0 rows means someone else got there first (412). */
export async function updateJobRow(
  trx: Transaction<Database>,
  current: Pick<JobRow, "id" | "version">,
  set: JobUpdateColumns,
): Promise<JobRow> {
  try {
    const row = await trx
      .updateTable("jobs")
      .set({ ...set, version: current.version + 1 })
      .where("id", "=", current.id)
      .where("version", "=", current.version)
      .where("deleted_at", "is", null)
      .returningAll()
      .executeTakeFirst();
    if (!row)
      throw new PreconditionFailedError({ detail: "This item was changed by someone else. Reload and try again." });
    return row;
  } catch (error) {
    if (isDuplicateJobNumber(error)) throw duplicateJobNumberError(set.job_number ?? "That job number");
    throw error;
  }
}

/** Archive = soft delete (DATA_MODEL §5): hidden from every list and from every grant; rows and files are kept. */
export async function archiveJobRow(
  trx: Transaction<Database>,
  current: Pick<JobRow, "id" | "version">,
  deletedBy: string,
  at: Date,
): Promise<void> {
  const row = await trx
    .updateTable("jobs")
    .set({ deleted_at: at, deleted_by: deletedBy, version: current.version + 1 })
    .where("id", "=", current.id)
    .where("version", "=", current.version)
    .where("deleted_at", "is", null)
    .returning("id")
    .executeTakeFirst();
  if (!row) throw staleJobError();
}

/**
 * Bump the job's version (and updated_at) for a change made through another module, so the job's ETag and the dashboard
 * card reflect every edit. 404 when the job was archived meanwhile.
 */
export async function bumpJobVersion(trx: Transaction<Database>, jobId: string): Promise<void> {
  const row = await trx
    .updateTable("jobs")
    .set((eb) => ({ version: eb("version", "+", 1) }))
    .where("id", "=", jobId)
    .where("deleted_at", "is", null)
    .returning("id")
    .executeTakeFirst();
  if (!row) throw new NotFoundError();
}
