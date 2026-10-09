/** Kysely access to `files`, `email_messages` and the rows an upload depends on (BE-7: no string-built SQL). */
import type { Database, Db, EmailMessageRow, FileRow } from "@kr/db";
import type { Kysely, Transaction } from "kysely";

type Executor = Kysely<Database> | Transaction<Database>;

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

export interface NewEmailMessage {
  readonly fileId: string;
  readonly parseStatus: "pending" | "parsed";
  readonly isPasted: boolean;
  readonly subject?: string | null;
  readonly fromText?: string | null;
  readonly bodyText?: string | null;
  readonly sentAt?: Date | null;
  readonly parsedAt?: Date | null;
}

export function insertEmailMessage(trx: Transaction<Database>, m: NewEmailMessage): Promise<EmailMessageRow> {
  return trx
    .insertInto("email_messages")
    .values({
      file_id: m.fileId,
      parse_status: m.parseStatus,
      is_pasted: m.isPasted,
      subject: m.subject ?? null,
      from_text: m.fromText ?? null,
      body_text: m.bodyText ?? null,
      sent_at: m.sentAt ?? null,
      parsed_at: m.parsedAt ?? null,
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

/** A condition of this job's CURRENT extraction (not superseded), locked so a re-extraction waits for the insert. */
export async function lockCurrentCondition(
  trx: Transaction<Database>,
  jobId: string,
  conditionId: string,
): Promise<boolean> {
  const row = await trx
    .selectFrom("conditions")
    .select("id")
    .where("id", "=", conditionId)
    .where("job_id", "=", jobId)
    .where("superseded_at", "is", null)
    .forShare()
    .executeTakeFirst();
  return row !== undefined;
}

export async function conditionIsCurrent(db: Db, jobId: string, conditionId: string): Promise<boolean> {
  const row = await db
    .selectFrom("conditions")
    .select("id")
    .where("id", "=", conditionId)
    .where("job_id", "=", jobId)
    .where("superseded_at", "is", null)
    .executeTakeFirst();
  return row !== undefined;
}

/** A file that has not been removed (soft delete hides it from everyone, PRODUCT_SPEC §11). */
export function findFile(db: Executor, fileId: string): Promise<FileRow | undefined> {
  return db.selectFrom("files").selectAll().where("id", "=", fileId).where("deleted_at", "is", null).executeTakeFirst();
}

export function findEmail(db: Executor, fileId: string): Promise<EmailMessageRow | undefined> {
  return db.selectFrom("email_messages").selectAll().where("file_id", "=", fileId).executeTakeFirst();
}

/** The uploader as the file view shows them: id and display name only. */
export async function findUploaderRef(
  db: Executor,
  userId: string,
): Promise<{ readonly id: string; readonly display_name: string } | null> {
  return (
    (await db.selectFrom("users").select(["id", "display_name"]).where("id", "=", userId).executeTakeFirst()) ?? null
  );
}

/** Soft delete (PRODUCT_SPEC §11): false when the file was already removed. */
export async function softDeleteFile(
  trx: Transaction<Database>,
  fileId: string,
  userId: string,
  at: Date,
): Promise<boolean> {
  const row = await trx
    .updateTable("files")
    .set({ deleted_at: at, deleted_by: userId })
    .where("id", "=", fileId)
    .where("deleted_at", "is", null)
    .returning("id")
    .executeTakeFirst();
  return row !== undefined;
}
