/** Kysely access to `files` and the rows an upload depends on (BE-7: no string-built SQL). */
import type { Database, FileRow } from "@kr/db";
import type { Transaction } from "kysely";

export interface NewFile {
  readonly id: string;
  readonly jobId: string;
  readonly target: { readonly checkpointKey: string; readonly slot: string } | { readonly conditionId: string };
  readonly storageKey: string;
  readonly originalName: string;
  readonly kind: FileRow["kind"];
  readonly contentType: string;
  readonly sizeBytes: number;
  readonly sha256: Buffer;
  readonly scanStatus: "pending" | "skipped";
  readonly uploadedBy: string;
  readonly uploadedAt: Date;
}

export function insertFile(trx: Transaction<Database>, f: NewFile): Promise<FileRow> {
  return trx
    .insertInto("files")
    .values({
      id: f.id,
      job_id: f.jobId,
      ...("conditionId" in f.target
        ? { condition_id: f.target.conditionId }
        : { checkpoint_key: f.target.checkpointKey, slot: f.target.slot }),
      storage_key: f.storageKey,
      original_name: f.originalName,
      kind: f.kind,
      content_type: f.contentType,
      size_bytes: f.sizeBytes,
      sha256: f.sha256,
      scan_status: f.scanStatus,
      uploaded_by: f.uploadedBy,
      uploaded_at: f.uploadedAt,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}

/**
 * Locks the job row against concurrent archiving for the rest of the transaction; false when the job is gone or was
 * archived after the caller's visibility check (the upload then answers 404 and the object is removed).
 */
export async function lockActiveJob(trx: Transaction<Database>, jobId: string): Promise<boolean> {
  const row = await trx
    .selectFrom("jobs")
    .select("id")
    .where("id", "=", jobId)
    .where("deleted_at", "is", null)
    .forShare()
    .executeTakeFirst();
  return row !== undefined;
}
