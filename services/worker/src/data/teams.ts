/** Links, layout folders and push rows as the Teams handlers read and write them (BE-7: Kysely only). */
import {
  enqueueOperation,
  recordAudit,
  type Database,
  type Db,
  type FileRow,
  type JobTeamsLinkRow,
  type TeamsFilePushRow,
  type TeamsLinkStatusValue,
  type TeamsPushStatusValue,
} from "@kr/db";
import { sql, type Transaction } from "kysely";

type Executor = Db | Transaction<Database>;

export function findLink(db: Executor, jobId: string): Promise<JobTeamsLinkRow | undefined> {
  return db.selectFrom("job_teams_links").selectAll().where("job_id", "=", jobId).executeTakeFirst();
}

export async function isJobArchived(db: Executor, jobId: string): Promise<boolean> {
  const job = await db.selectFrom("jobs").select("deleted_at").where("id", "=", jobId).executeTakeFirst();
  return job?.deleted_at !== null;
}

export interface LinkResolution {
  readonly drive_id: string;
  readonly channel_folder_item_id: string;
  readonly root_folder_item_id: string;
  readonly sharepoint_url: string | null;
  readonly team_site_url: string;
}

export async function markLinkReady(db: Executor, jobId: string, r: LinkResolution, now: Date): Promise<void> {
  await db
    .updateTable("job_teams_links")
    .set({ ...r, status: "ready", error_code: null, provisioned_at: now })
    .where("job_id", "=", jobId)
    .execute();
}

export async function markLinkError(db: Executor, jobId: string, errorCode: string): Promise<void> {
  await db
    .updateTable("job_teams_links")
    .set({ status: "error", error_code: errorCode.slice(0, 80) })
    .where("job_id", "=", jobId)
    .execute();
}

export async function touchLinkPush(db: Executor, jobId: string, now: Date): Promise<void> {
  await db.updateTable("job_teams_links").set({ last_push_at: now }).where("job_id", "=", jobId).execute();
}

/** Stored folder ids by relative path. */
export async function readFolders(db: Executor, jobId: string): Promise<Map<string, string>> {
  const rows = await db
    .selectFrom("teams_folders")
    .select(["folder_path", "drive_item_id"])
    .where("job_id", "=", jobId)
    .execute();
  return new Map(rows.map((r) => [r.folder_path, r.drive_item_id]));
}

export async function saveFolder(db: Executor, jobId: string, path: string, driveItemId: string): Promise<void> {
  await db
    .insertInto("teams_folders")
    .values({ job_id: jobId, folder_path: path, drive_item_id: driveItemId })
    .onConflict((oc) => oc.columns(["job_id", "folder_path"]).doUpdateSet({ drive_item_id: driveItemId }))
    .execute();
}

export type PushFile = Pick<
  FileRow,
  | "id"
  | "job_id"
  | "storage_key"
  | "original_name"
  | "kind"
  | "content_type"
  | "size_bytes"
  | "checkpoint_key"
  | "condition_id"
  | "scan_status"
  | "deleted_at"
  | "purged_at"
>;

const PUSH_FILE_COLUMNS = [
  "id",
  "job_id",
  "storage_key",
  "original_name",
  "kind",
  "content_type",
  "size_bytes",
  "checkpoint_key",
  "condition_id",
  "scan_status",
  "deleted_at",
  "purged_at",
] as const;

export function findPushFile(db: Executor, fileId: string): Promise<PushFile | undefined> {
  return db.selectFrom("files").select(PUSH_FILE_COLUMNS).where("id", "=", fileId).executeTakeFirst();
}

/** Every file of the job that is present and scanned clean: what provisioning queues (decision 7). */
export function listCleanFiles(db: Executor, jobId: string): Promise<PushFile[]> {
  return db
    .selectFrom("files")
    .select(PUSH_FILE_COLUMNS)
    .where("job_id", "=", jobId)
    .where("deleted_at", "is", null)
    .where("purged_at", "is", null)
    .where("scan_status", "=", "clean")
    .orderBy("uploaded_at")
    .execute();
}

/** The job's current (not superseded) conditions, for evidence folders. */
export function listConditions(db: Executor, jobId: string): Promise<{ id: string; number: number; agency: string }[]> {
  return db
    .selectFrom("conditions")
    .select(["id", "condition_number as number", "agency"])
    .where("job_id", "=", jobId)
    .where("superseded_at", "is", null)
    .execute();
}

/** Inserts a push row in `status` unless the file already has one (a re-run must not reset a pushed row). */
export async function ensurePushRow(
  db: Executor,
  file: Pick<PushFile, "id" | "job_id">,
  status: Extract<TeamsPushStatusValue, "pending" | "excluded">,
  errorCode: string | null = null,
): Promise<boolean> {
  const r = await db
    .insertInto("teams_file_pushes")
    .values({ file_id: file.id, job_id: file.job_id, status, error_code: errorCode })
    .onConflict((oc) => oc.column("file_id").doNothing())
    .executeTakeFirst();
  return (r.numInsertedOrUpdatedRows ?? 0n) > 0n;
}

/** teams_folders key of the job's subfolder in the Fee Proposals channel's library (not a layout path). */
export const FEE_FOLDER_KEY = "$fee";

export async function jobNumberOf(db: Executor, jobId: string): Promise<string> {
  const row = await db.selectFrom("jobs").select("job_number").where("id", "=", jobId).executeTakeFirstOrThrow();
  return row.job_number;
}

/** Under the restricted policy, fee-proposal rows parked as excluded (`fee_proposal_pending`) become due again. */
export async function reviveFeeRows(db: Executor, jobId: string): Promise<number> {
  const r = await db
    .updateTable("teams_file_pushes")
    .set({ status: "pending", error_code: null })
    .where("job_id", "=", jobId)
    .where("status", "=", "excluded")
    .where("error_code", "=", "fee_proposal_pending")
    .executeTakeFirst();
  return Number(r.numUpdatedRows);
}

/**
 * Rows to work through, oldest first: pending ones, failed ones under the attempt limit, and `uploading` ones left by a
 * run that crashed between the upload and the record (the handler adopts or renames those, decision 8).
 */
export function listDuePushes(db: Executor, jobId: string, maxAttempts: number): Promise<TeamsFilePushRow[]> {
  return db
    .selectFrom("teams_file_pushes")
    .selectAll()
    .where("job_id", "=", jobId)
    .where((eb) =>
      eb.or([
        eb("status", "=", "pending"),
        eb("status", "=", "uploading"),
        eb.and([eb("status", "=", "deleting"), eb("attempts", "<", maxAttempts)]),
        eb.and([eb("status", "=", "failed"), eb("attempts", "<", maxAttempts)]),
      ]),
    )
    .orderBy("created_at")
    .execute();
}

export async function updatePush(
  db: Executor,
  fileId: string,
  set: Partial<Omit<TeamsFilePushRow, "file_id" | "job_id">>,
  now: Date,
): Promise<void> {
  await db
    .updateTable("teams_file_pushes")
    .set({ ...set, updated_at: now })
    .where("file_id", "=", fileId)
    .execute();
}

/** Queues one `teams.push` for the job unless one is queued or running already. Returns its id. */
export async function queuePush(db: Executor, jobId: string): Promise<string> {
  const existing = await db
    .selectFrom("operations")
    .select("id")
    .where("job_id", "=", jobId)
    .where("type", "=", "teams.push")
    .where("status", "in", ["queued", "running"])
    .executeTakeFirst();
  if (existing) return existing.id;
  const op = await enqueueOperation(db, { jobId, type: "teams.push", payload: {}, createdBy: null });
  return op.id;
}

/**
 * The file-scan hook (decision 7): once a scan passes as clean, with copying on and the link ready, insert the push
 * row and queue `teams.push` in the scan's own transaction. Returns the queued operation id, or null when nothing
 * was done (sync off, no ready link, policy exclude). Fee-proposal files get an `excluded` row so the panel can count them.
 */
export async function queuePushAfterScan(
  trx: Transaction<Database>,
  file: Pick<PushFile, "id" | "job_id" | "checkpoint_key">,
  policy: "sync" | "exclude" | "restricted",
): Promise<string | null> {
  const link = await trx
    .selectFrom("job_teams_links")
    .innerJoin("teams_settings", (join) => join.on("teams_settings.singleton", "=", true))
    .select(["job_teams_links.status", "teams_settings.sync_enabled", "teams_settings.fee_site_url"])
    .where("job_teams_links.job_id", "=", file.job_id)
    .executeTakeFirst();
  if (!link?.sync_enabled || link.status !== "ready") return null;
  if (policy === "exclude" || (policy === "restricted" && !link.fee_site_url)) {
    await ensurePushRow(trx, file, "excluded", policy === "restricted" ? "fee_proposal_pending" : "policy_exclude");
    return null;
  }
  await ensurePushRow(trx, file, "pending");
  return queuePush(trx, file.job_id);
}

/** Jobs with due push rows, a ready link and no push queued or running: what the retry sweep requeues. */
export async function jobsWithDuePushes(db: Db, maxAttempts: number, limit = 100): Promise<string[]> {
  const settings = await db.selectFrom("teams_settings").select("fee_proposal_policy").executeTakeFirstOrThrow();
  const rows = await db
    .selectFrom("teams_file_pushes as p")
    .innerJoin("job_teams_links as l", "l.job_id", "p.job_id")
    .select("p.job_id")
    .distinct()
    .where("l.status", "=", "ready")
    .where((eb) =>
      eb.or([
        eb("p.status", "=", "pending"),
        eb("p.status", "=", "uploading"),
        eb.and([eb("p.status", "=", "deleting"), eb("p.attempts", "<", maxAttempts)]),
        eb.and([eb("p.status", "=", "failed"), eb("p.attempts", "<", maxAttempts)]),
        ...(settings.fee_proposal_policy === "restricted"
          ? [eb.and([eb("p.status", "=", "excluded"), eb("p.error_code", "=", "fee_proposal_pending")])]
          : []),
      ]),
    )
    .where(
      sql<boolean>`NOT EXISTS (SELECT 1 FROM operations o WHERE o.job_id = p.job_id AND o.type = 'teams.push' AND o.status IN ('queued', 'running'))`,
    )
    .limit(limit)
    .execute();
  return rows.map((r) => r.job_id);
}

export function auditSystem(
  db: Executor,
  action: string,
  jobId: string,
  entityType: string,
  entityId: string,
  changes: Record<string, { from: unknown; to: unknown }> | null = null,
): Promise<void> {
  return recordAudit(db, { actorUserId: null, action, entityType, entityId, jobId, changes });
}

export type { TeamsLinkStatusValue };
