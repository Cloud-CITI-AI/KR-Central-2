/** Loads the rows behind one job's tracker view (reads only; BE-7 Kysely). Works on a connection or a transaction. */
import type { Database } from "@kr/db";
import { CHECKPOINTS } from "@kr/workflow";
import type { Kysely } from "kysely";
import type { JobParts } from "../domain/job-detail.js";

const RESTRICTED_KEYS = CHECKPOINTS.filter((c) => c.restricted === "fee_proposal").map((c) => c.key);

/**
 * @param canSeeFeeProposal when false, files of the restricted checkpoint are not even read
 * @returns undefined when the job does not exist or is archived
 */
export async function loadJobParts(
  db: Kysely<Database>,
  jobId: string,
  canSeeFeeProposal: boolean,
): Promise<JobParts | undefined> {
  const job = await db
    .selectFrom("jobs")
    .selectAll()
    .where("id", "=", jobId)
    .where("deleted_at", "is", null)
    .executeTakeFirst();
  if (!job) return undefined;
  const states = await db.selectFrom("checkpoint_states").selectAll().where("job_id", "=", jobId).execute();
  const conditions = await db
    .selectFrom("conditions")
    .selectAll()
    .where("job_id", "=", jobId)
    .where("superseded_at", "is", null)
    .orderBy("condition_number")
    .execute();
  let filesQuery = db
    .selectFrom("files")
    .selectAll()
    .where("job_id", "=", jobId)
    .where("deleted_at", "is", null)
    .orderBy("uploaded_at")
    .orderBy("id");
  if (!canSeeFeeProposal) {
    filesQuery = filesQuery.where((eb) =>
      eb.or([eb("checkpoint_key", "is", null), eb("checkpoint_key", "not in", RESTRICTED_KEYS)]),
    );
  }
  const files = await filesQuery.execute();
  const emails = await db
    .selectFrom("email_messages")
    .selectAll("email_messages")
    .innerJoin("files", "files.id", "email_messages.file_id")
    .where("files.job_id", "=", jobId)
    .where("files.deleted_at", "is", null)
    .execute();
  const userIds = new Set<string>();
  for (const s of states) for (const id of [s.paid_by, s.decided_by]) if (id) userIds.add(id);
  for (const f of files) if (f.uploaded_by) userIds.add(f.uploaded_by);
  const users =
    userIds.size === 0
      ? []
      : await db
          .selectFrom("users")
          .select(["id", "display_name"])
          .where("id", "in", [...userIds])
          .execute();
  const nameIds = [job.conformed_file_id, job.conditions_source_file_id].filter((id): id is string => id !== null);
  const names =
    nameIds.length === 0
      ? []
      : await db.selectFrom("files").select(["id", "original_name"]).where("id", "in", nameIds).execute();
  return {
    job,
    states,
    conditions,
    files,
    emails,
    users,
    fileNames: new Map(names.map((n) => [n.id, n.original_name])),
  };
}
