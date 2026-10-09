/** job_notes queries (DATA_MODEL §3): newest first by (created_at, id), soft delete. */
import type { Database, Db, JobNoteRow } from "@kr/db";
import { sql, type Transaction } from "kysely";

export interface NoteWithAuthor {
  readonly row: JobNoteRow;
  readonly authorName: string | null;
}

/** One page of a job's live notes, newest first; `afterId` is the last note of the previous page. */
export async function listNoteRows(
  db: Db,
  jobId: string,
  afterId: string | null,
  limit: number,
): Promise<NoteWithAuthor[]> {
  let q = db
    .selectFrom("job_notes")
    .leftJoin("users", "users.id", "job_notes.author_id")
    .selectAll("job_notes")
    .select("users.display_name as author_name")
    .where("job_notes.job_id", "=", jobId)
    .where("job_notes.deleted_at", "is", null);
  if (afterId !== null) {
    // The position is read back from the cursor note itself, so microsecond timestamps compare exactly.
    q = q.where(
      sql<boolean>`(job_notes.created_at, job_notes.id) < (select c.created_at, c.id from job_notes c where c.id = ${afterId})`,
    );
  }
  const rows = await q
    .orderBy("job_notes.created_at", "desc")
    .orderBy("job_notes.id", "desc")
    .limit(limit + 1)
    .execute();
  return rows.map(({ author_name, ...row }) => ({ row, authorName: author_name }));
}

export function insertNote(
  trx: Transaction<Database>,
  note: { jobId: string; authorId: string; body: string; audience: JobNoteRow["audience"] },
  at: Date,
): Promise<JobNoteRow> {
  return trx
    .insertInto("job_notes")
    .values({
      job_id: note.jobId,
      author_id: note.authorId,
      body: note.body,
      audience: note.audience,
      created_at: at,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}

/** Lock a live note of this job (so two deletes of one note cannot both succeed). */
export function lockLiveNote(
  trx: Transaction<Database>,
  jobId: string,
  noteId: string,
): Promise<JobNoteRow | undefined> {
  return trx
    .selectFrom("job_notes")
    .selectAll()
    .where("id", "=", noteId)
    .where("job_id", "=", jobId)
    .where("deleted_at", "is", null)
    .forUpdate()
    .executeTakeFirst();
}

export async function softDeleteNote(trx: Transaction<Database>, noteId: string, by: string, at: Date): Promise<void> {
  await trx.updateTable("job_notes").set({ deleted_at: at, deleted_by: by }).where("id", "=", noteId).execute();
}
