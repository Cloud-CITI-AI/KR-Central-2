/** Reads behind the document-reading requests (BE-7: Kysely only). Run inside the request's transaction. */
import type { Database } from "@kr/db";
import type { Transaction } from "kysely";
import type { RequestedFile } from "../domain/start-request.js";

/** The file by id and job, deleted ones included (the rule rejects them); another job's file is simply not found. */
export function findRequestedFile(
  trx: Transaction<Database>,
  jobId: string,
  fileId: string,
): Promise<RequestedFile | undefined> {
  return trx
    .selectFrom("files")
    .select([
      "id",
      "job_id",
      "checkpoint_key",
      "slot",
      "original_name",
      "kind",
      "scan_status",
      "scan_retries_exhausted",
      "deleted_at",
    ])
    .where("id", "=", fileId)
    .where("job_id", "=", jobId)
    .executeTakeFirst();
}

/** How many current (not superseded) conditions the job has. */
export async function countCurrentConditions(trx: Transaction<Database>, jobId: string): Promise<number> {
  const row = await trx
    .selectFrom("conditions")
    .select((eb) => eb.fn.countAll<string>().as("n"))
    .where("job_id", "=", jobId)
    .where("superseded_at", "is", null)
    .executeTakeFirstOrThrow();
  return Number(row.n);
}

/**
 * Whether a reading of this kind is already queued or running for the job. Takes a row lock on the job first (FOR NO KEY UPDATE:
 * it does not block the foreign-key checks of the operations insert), so two simultaneous start requests cannot both see "none":
 * the second waits, then finds the first one's operation.
 */
export async function hasActiveOperation(
  trx: Transaction<Database>,
  jobId: string,
  type: "conditions.extract" | "conformance.read",
): Promise<boolean> {
  await trx.selectFrom("jobs").select("id").where("id", "=", jobId).forNoKeyUpdate().executeTakeFirst();
  const row = await trx
    .selectFrom("operations")
    .select("id")
    .where("job_id", "=", jobId)
    .where("type", "=", type)
    .where("status", "in", ["queued", "running"])
    .limit(1)
    .executeTakeFirst();
  return row !== undefined;
}
