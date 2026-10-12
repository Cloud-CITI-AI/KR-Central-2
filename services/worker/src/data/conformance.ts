/** The transactional write of a conformed-date reading (BE-7: Kysely only). Run inside one transaction. */
import { diffChanges, recordAudit, type Database } from "@kr/db";
import { outcomeDateFor } from "@kr/workflow";
import { sql, type Transaction } from "kysely";
import { isUsableReading, type Found } from "../domain/conformance.js";
import { TaskError } from "../errors.js";

/** conformed_stamp_text allows 200 characters. */
const MAX_STAMP_TEXT = 200;

/**
 * Overwrites the job's conformed date, method, source file, stamp text and outcome date (conformed + 90 days), whatever was
 * there before, even a date entered by hand (PRODUCT_SPEC §10.1). The job version goes up and one system audit row records
 * what changed; a re-run that changes nothing writes nothing.
 */
export async function applyConformedDate(
  trx: Transaction<Database>,
  x: { readonly jobId: string; readonly fileId: string; readonly found: Found },
): Promise<void> {
  const job = await trx
    .selectFrom("jobs")
    .select([
      "conformed_date",
      "conformed_method",
      "conformed_file_id",
      "conformed_stamp_text",
      "outcome_date",
      "deleted_at",
    ])
    .where("id", "=", x.jobId)
    .forUpdate()
    .executeTakeFirst();
  if (!job || job.deleted_at) throw new TaskError("job_unavailable", "The job is no longer available.");
  // Never commit a date (or an outcome date derived from it) that the job page cannot show; the handler skips such readings first.
  if (!isUsableReading(x.found)) throw new TaskError("invalid_date", "The date that was read is not a usable date.");
  const after = {
    conformedDate: x.found.date,
    conformedMethod: x.found.method,
    conformedFileId: x.fileId,
    conformedStampText: x.found.stampText?.slice(0, MAX_STAMP_TEXT) ?? null,
    outcomeDate: outcomeDateFor(x.found.date),
  };
  const changes = diffChanges(
    {
      conformedDate: job.conformed_date,
      conformedMethod: job.conformed_method,
      conformedFileId: job.conformed_file_id,
      conformedStampText: job.conformed_stamp_text,
      outcomeDate: job.outcome_date,
    },
    after,
  );
  if (!changes) return;
  await trx
    .updateTable("jobs")
    .set({
      conformed_date: after.conformedDate,
      conformed_method: after.conformedMethod,
      conformed_file_id: after.conformedFileId,
      conformed_stamp_text: after.conformedStampText,
      outcome_date: after.outcomeDate,
      version: sql<number>`version + 1`,
    })
    .where("id", "=", x.jobId)
    .execute();
  await recordAudit(trx, {
    actorUserId: null,
    action: "conformance.date_read",
    entityType: "job",
    entityId: x.jobId,
    jobId: x.jobId,
    changes,
  });
}
