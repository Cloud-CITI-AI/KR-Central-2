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
    .select(["id", "job_id", "checkpoint_key", "slot", "original_name", "kind", "scan_status", "deleted_at"])
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
