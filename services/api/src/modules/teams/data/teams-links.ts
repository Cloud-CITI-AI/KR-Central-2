/** Reads and writes of job_teams_links and the push counts (BE-7: Kysely only). */
import {
  enqueueOperation,
  type Database,
  type Db,
  type JobTeamsLinkRow,
  type NewJobTeamsLink,
  type OperationRow,
  type TeamsPushStatusValue,
} from "@kr/db";
import type { Transaction } from "kysely";

type Executor = Db | Transaction<Database>;

export interface LinkRead {
  readonly link: JobTeamsLinkRow;
  readonly linkedBy: { id: string; displayName: string } | null;
  readonly counts: Readonly<Record<TeamsPushStatusValue, number>>;
  /** The newest queued or running provisioning task of this job. */
  readonly provisioning: Pick<OperationRow, "id"> | null;
}

export async function findLink(db: Executor, jobId: string, lock = false): Promise<JobTeamsLinkRow | undefined> {
  let q = db.selectFrom("job_teams_links").selectAll().where("job_id", "=", jobId);
  if (lock) q = q.forUpdate();
  return q.executeTakeFirst();
}

export async function readLink(db: Executor, jobId: string): Promise<LinkRead | null> {
  const link = await findLink(db, jobId);
  if (!link) return null;
  const [user, rows, provisioning] = await Promise.all([
    link.linked_by
      ? db.selectFrom("users").select(["id", "display_name"]).where("id", "=", link.linked_by).executeTakeFirst()
      : Promise.resolve(undefined),
    db
      .selectFrom("teams_file_pushes")
      .select(["status", (eb) => eb.fn.countAll<string>().as("n")])
      .where("job_id", "=", jobId)
      .groupBy("status")
      .execute(),
    db
      .selectFrom("operations")
      .select("id")
      .where("job_id", "=", jobId)
      .where("type", "=", "teams.provision")
      .where("status", "in", ["queued", "running"])
      .orderBy("created_at", "desc")
      .limit(1)
      .executeTakeFirst(),
  ]);
  const counts: Record<TeamsPushStatusValue, number> = {
    pending: 0,
    uploading: 0,
    pushed: 0,
    excluded: 0,
    failed: 0,
    deleting: 0,
    deleted: 0,
  };
  for (const r of rows) counts[r.status] = Number(r.n);
  return {
    link,
    linkedBy: user ? { id: user.id, displayName: user.display_name } : null,
    counts,
    provisioning: provisioning ?? null,
  };
}

/** The job (other than `jobId`) already holding this channel of this team, if any. */
export async function findChannelOwner(
  db: Executor,
  teamId: string,
  channelId: string,
  jobId: string,
): Promise<{ job_id: string; job_number: string } | undefined> {
  return db
    .selectFrom("job_teams_links")
    .innerJoin("jobs", "jobs.id", "job_teams_links.job_id")
    .select(["job_teams_links.job_id", "jobs.job_number"])
    .where("job_teams_links.team_id", "=", teamId)
    .where("job_teams_links.channel_id", "=", channelId)
    .where("job_teams_links.job_id", "<>", jobId)
    .executeTakeFirst();
}

/** Insert the link, or replace an existing one (relink): status back to provisioning, ids cleared, version bumped. */
export async function upsertLink(trx: Transaction<Database>, values: NewJobTeamsLink): Promise<JobTeamsLinkRow> {
  return trx
    .insertInto("job_teams_links")
    .values(values)
    .onConflict((oc) =>
      oc.column("job_id").doUpdateSet({
        team_id: values.team_id,
        team_site_url: values.team_site_url ?? null,
        channel_id: values.channel_id,
        channel_name: values.channel_name,
        teams_url: values.teams_url,
        status: "provisioning",
        drive_id: null,
        channel_folder_item_id: null,
        root_folder_item_id: null,
        sharepoint_url: null,
        error_code: null,
        linked_by: values.linked_by,
        linked_at: new Date(),
        provisioned_at: null,
        version: (eb) => eb("job_teams_links.version", "+", 1),
      }),
    )
    .returningAll()
    .executeTakeFirstOrThrow();
}

/** Relinking forgets the folders of the previous channel; the push rows are reset by provisioning. */
export async function clearFolders(trx: Transaction<Database>, jobId: string): Promise<void> {
  await trx.deleteFrom("teams_folders").where("job_id", "=", jobId).execute();
}

export async function deleteLink(trx: Transaction<Database>, jobId: string): Promise<boolean> {
  const r = await trx.deleteFrom("job_teams_links").where("job_id", "=", jobId).executeTakeFirst();
  return r.numDeletedRows > 0n;
}

export async function queueProvision(
  trx: Transaction<Database>,
  jobId: string,
  createdBy: string,
): Promise<OperationRow> {
  return enqueueOperation(trx, { jobId, type: "teams.provision", payload: {}, createdBy });
}
