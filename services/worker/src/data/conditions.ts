/** The transactional part of a Decision Letter extraction (BE-7: Kysely only). Run inside one transaction. */
import { diffChanges, recordAudit, type Database } from "@kr/db";
import type { ParsedCondition } from "@kr/document-parsing";
import { sql, type Transaction } from "kysely";
import { storedText } from "../domain/extraction.js";
import { TaskError } from "../errors.js";

export interface ExtractionInput {
  readonly jobId: string;
  readonly fileId: string;
  readonly operationId: string;
  readonly replaceExisting: boolean;
  readonly conditions: readonly ParsedCondition[];
  readonly approvalDate: string | null;
  readonly approvalExpiry: string | null;
  readonly now: Date;
}

/**
 * Supersedes the current conditions (and soft-deletes their evidence) when replacing, inserts the new ones, and sets the job's
 * approval date and expiry (never the outcome date) when found, with the source file and extraction time when conditions were
 * stored. A re-run of an extraction that was already applied changes nothing.
 */
export async function applyExtraction(trx: Transaction<Database>, x: ExtractionInput): Promise<void> {
  const job = await trx
    .selectFrom("jobs")
    .select(["approval_date", "approval_expiry", "conditions_source_file_id", "deleted_at"])
    .where("id", "=", x.jobId)
    .forUpdate()
    .executeTakeFirst();
  if (!job || job.deleted_at) throw new TaskError("job_unavailable", "The job is no longer available.");
  const applied = await trx
    .selectFrom("conditions")
    .select("id")
    .where("extraction_id", "=", x.operationId)
    .limit(1)
    .executeTakeFirst();
  if (applied) return;

  const current = await trx
    .selectFrom("conditions")
    .select("id")
    .where("job_id", "=", x.jobId)
    .where("superseded_at", "is", null)
    .execute();
  const storing = x.conditions.length > 0;
  if (storing && current.length > 0 && !x.replaceExisting) {
    throw new TaskError(
      "replace_required",
      "Conditions already exist for this job. Open the job and choose to replace them.",
    );
  }
  if (storing && current.length > 0) {
    const ids = current.map((c) => c.id);
    await trx
      .updateTable("files")
      .set({ deleted_at: x.now })
      .where("condition_id", "in", ids)
      .where("deleted_at", "is", null)
      .execute();
    await trx.updateTable("conditions").set({ superseded_at: x.now }).where("id", "in", ids).execute();
  }
  if (storing) {
    await trx
      .insertInto("conditions")
      .values(
        x.conditions.map((c) => ({
          job_id: x.jobId,
          condition_number: c.number,
          text: storedText(c),
          agency: c.agency,
          agency_guessed: c.agencyGuessed,
          extraction_id: x.operationId,
        })),
      )
      .execute();
  }

  const after = {
    approvalDate: x.approvalDate ?? job.approval_date,
    approvalExpiry: x.approvalExpiry ?? job.approval_expiry,
    sourceFileId: storing ? x.fileId : job.conditions_source_file_id,
  };
  const changed = diffChanges(
    {
      approvalDate: job.approval_date,
      approvalExpiry: job.approval_expiry,
      sourceFileId: job.conditions_source_file_id,
    },
    after,
  );
  if (!changed && !storing) return;
  await trx
    .updateTable("jobs")
    .set({
      approval_date: after.approvalDate,
      approval_expiry: after.approvalExpiry,
      conditions_source_file_id: after.sourceFileId,
      ...(storing ? { conditions_extracted_at: x.now } : {}),
      version: sql<number>`version + 1`,
    })
    .where("id", "=", x.jobId)
    .execute();
  await recordAudit(trx, {
    actorUserId: null,
    action: "conditions.extracted",
    entityType: "operation",
    entityId: x.operationId,
    jobId: x.jobId,
    changes: { ...(storing ? { conditionsCount: { from: current.length, to: x.conditions.length } } : {}), ...changed },
  });
}
