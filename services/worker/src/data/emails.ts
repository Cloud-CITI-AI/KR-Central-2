/** email_messages queries of the email.parse handler (BE-7: Kysely only). */
import type { Db, FileRow } from "@kr/db";
import type { EmailFields } from "../domain/email-fields.js";

export type EmailTarget = Pick<
  FileRow,
  "id" | "job_id" | "storage_key" | "scan_status" | "deleted_at" | "purged_at"
> & {
  readonly parse_status: "pending" | "parsed" | "failed" | null;
  readonly is_pasted: boolean | null;
};

/** The email file with its parse state (null columns when the email_messages row is missing). */
export function findEmailTarget(db: Db, fileId: string): Promise<EmailTarget | undefined> {
  return db
    .selectFrom("files")
    .leftJoin("email_messages", "email_messages.file_id", "files.id")
    .select([
      "files.id",
      "files.job_id",
      "files.storage_key",
      "files.scan_status",
      "files.deleted_at",
      "files.purged_at",
      "email_messages.parse_status",
      "email_messages.is_pasted",
    ])
    .where("files.id", "=", fileId)
    .where("files.kind", "=", "email")
    .executeTakeFirst();
}

/** Records the parse (insert when the row is missing). `fields` null marks the parse failed. */
export async function saveEmail(db: Db, fileId: string, fields: EmailFields | null): Promise<void> {
  const values = fields === null ? { parse_status: "failed" as const } : { parse_status: "parsed" as const, ...fields };
  await db
    .insertInto("email_messages")
    .values({ file_id: fileId, ...values, parsed_at: new Date() })
    .onConflict((c) => c.column("file_id").doUpdateSet({ ...values, parsed_at: new Date() }))
    .execute();
}
