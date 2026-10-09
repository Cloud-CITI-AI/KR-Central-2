/** Condition reads and the versioned write (DATA_MODEL §6; BE-7: Kysely only). Run inside the request's transaction. */
import type { ConditionRow, Database, EmailMessageRow, FileRow, UserRow } from "@kr/db";
import type { Transaction } from "kysely";
import { PreconditionFailedError } from "../../../platform/errors.js";
import type { ConditionColumns } from "../domain/condition-update.js";

/** The current (not superseded) condition of this job, locked for the rest of the transaction. */
export function lockCurrentCondition(
  trx: Transaction<Database>,
  jobId: string,
  conditionId: string,
): Promise<ConditionRow | undefined> {
  return trx
    .selectFrom("conditions")
    .selectAll()
    .where("id", "=", conditionId)
    .where("job_id", "=", jobId)
    .where("superseded_at", "is", null)
    .forUpdate()
    .executeTakeFirst();
}

/** `UPDATE … SET …, version = version + 1 WHERE … AND version = $n`; 0 rows means someone else got there first (412). */
export async function writeCondition(
  trx: Transaction<Database>,
  current: Pick<ConditionRow, "id" | "version">,
  set: ConditionColumns,
  updatedBy: string,
): Promise<ConditionRow> {
  const row = await trx
    .updateTable("conditions")
    .set({ ...set, updated_by: updatedBy, version: current.version + 1 })
    .where("id", "=", current.id)
    .where("version", "=", current.version)
    .returningAll()
    .executeTakeFirst();
  if (!row) {
    throw new PreconditionFailedError({ detail: "This item was changed by someone else. Reload and try again." });
  }
  return row;
}

export interface EvidenceRows {
  readonly files: readonly FileRow[];
  readonly uploaders: readonly Pick<UserRow, "id" | "display_name">[];
  readonly emails: readonly EmailMessageRow[];
}

/** The condition's evidence files (not deleted) with the rows the file metadata needs. */
export async function loadEvidence(trx: Transaction<Database>, conditionId: string): Promise<EvidenceRows> {
  const files = await trx
    .selectFrom("files")
    .selectAll()
    .where("condition_id", "=", conditionId)
    .where("deleted_at", "is", null)
    .orderBy("uploaded_at")
    .orderBy("id")
    .execute();
  const uploaderIds = [...new Set(files.flatMap((f) => (f.uploaded_by ? [f.uploaded_by] : [])))];
  const uploaders =
    uploaderIds.length === 0
      ? []
      : await trx.selectFrom("users").select(["id", "display_name"]).where("id", "in", uploaderIds).execute();
  const emails =
    files.length === 0
      ? []
      : await trx
          .selectFrom("email_messages")
          .selectAll()
          .where(
            "file_id",
            "in",
            files.map((f) => f.id),
          )
          .execute();
  return { files, uploaders, emails };
}
