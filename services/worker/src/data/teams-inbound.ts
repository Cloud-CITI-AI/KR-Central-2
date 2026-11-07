/** Inbound items and the file rows an import creates (BE-7: Kysely only). */
import { createHash, randomUUID } from "node:crypto";
import { enqueueOperation, type Database, type Db, type FileKindValue, type TeamsInboundItemRow } from "@kr/db";
import { objectKeyFor } from "@kr/storage";
import type { Transaction } from "kysely";
import type { InboundRecord, OwnItem } from "../domain/teams-inbound.js";

type Executor = Db | Transaction<Database>;

/** Drive item ids of the files the app pushed for this job, with the eTag it recorded. */
export async function ownItems(db: Executor, jobId: string): Promise<Map<string, OwnItem>> {
  const rows = await db
    .selectFrom("teams_file_pushes")
    .select(["file_id", "drive_item_id", "etag"])
    .where("job_id", "=", jobId)
    .where("status", "in", ["pushed", "deleting"])
    .where("drive_item_id", "is not", null)
    .execute();
  return new Map(rows.map((r) => [r.drive_item_id ?? "", { fileId: r.file_id, eTag: r.etag }]));
}

export async function recordedItems(db: Executor, jobId: string): Promise<Map<string, InboundRecord>> {
  const rows = await db
    .selectFrom("teams_inbound_items")
    .select(["drive_item_id", "status", "etag"])
    .where("job_id", "=", jobId)
    .execute();
  return new Map(rows.map((r) => [r.drive_item_id, { status: r.status, eTag: r.etag }]));
}

export function findInbound(db: Executor, jobId: string, itemId: string): Promise<TeamsInboundItemRow | undefined> {
  return db
    .selectFrom("teams_inbound_items")
    .selectAll()
    .where("job_id", "=", jobId)
    .where("drive_item_id", "=", itemId)
    .executeTakeFirst();
}

export interface InboundUpsert {
  readonly jobId: string;
  readonly itemId: string;
  readonly remotePath: string;
  readonly name: string;
  readonly sizeBytes: number | null;
  readonly eTag: string | null;
  readonly modifiedByName: string | null;
  readonly modifiedAt: Date | null;
  readonly status: TeamsInboundItemRow["status"];
  readonly fileId?: string | null;
  readonly errorCode?: string | null;
}

export async function upsertInbound(db: Executor, u: InboundUpsert, now: Date): Promise<void> {
  const values = {
    job_id: u.jobId,
    drive_item_id: u.itemId,
    remote_path: u.remotePath.slice(0, 800),
    name: u.name.slice(0, 255),
    size_bytes: u.sizeBytes,
    etag: u.eTag,
    modified_by_name: u.modifiedByName,
    modified_at: u.modifiedAt,
    status: u.status,
    file_id: u.fileId ?? null,
    error_code: u.errorCode ?? null,
    updated_at: now,
  };
  await db
    .insertInto("teams_inbound_items")
    .values(values)
    .onConflict((oc) => oc.columns(["job_id", "drive_item_id"]).doUpdateSet(values))
    .execute();
}

export async function markInbound(
  db: Executor,
  jobId: string,
  itemId: string,
  status: TeamsInboundItemRow["status"],
  now: Date,
  errorCode: string | null = null,
): Promise<void> {
  await db
    .updateTable("teams_inbound_items")
    .set({ status, error_code: errorCode, updated_at: now })
    .where("job_id", "=", jobId)
    .where("drive_item_id", "=", itemId)
    .execute();
}

export interface ImportedFile {
  readonly jobId: string;
  readonly checkpointKey: string | null;
  readonly slot: string | null;
  readonly conditionId: string | null;
  readonly name: string;
  readonly kind: FileKindValue;
  readonly contentType: string;
  readonly bytes: Uint8Array;
}

/** Inserts the files row (scan pending, source teams, no uploader) and, for an email, its message row. Returns id and key. */
export async function insertImportedFile(
  trx: Transaction<Database>,
  f: ImportedFile,
): Promise<{ id: string; storageKey: string }> {
  const id = randomUUID();
  const storageKey = objectKeyFor(f.jobId, id);
  await trx
    .insertInto("files")
    .values({
      id,
      job_id: f.jobId,
      checkpoint_key: f.checkpointKey,
      slot: f.slot,
      condition_id: f.conditionId,
      storage_key: storageKey,
      original_name: f.name.slice(0, 255),
      kind: f.kind,
      content_type: f.contentType,
      size_bytes: f.bytes.byteLength,
      sha256: createHash("sha256").update(f.bytes).digest(),
      scan_status: "pending",
      uploaded_by: null,
      source: "teams",
    })
    .execute();
  if (f.kind === "email") {
    await trx.insertInto("email_messages").values({ file_id: id, parse_status: "pending", is_pasted: false }).execute();
  }
  return { id, storageKey };
}

export async function queueScan(trx: Transaction<Database>, jobId: string, fileId: string): Promise<string> {
  const op = await enqueueOperation(trx, { jobId, type: "file.scan", payload: { fileId }, createdBy: null });
  return op.id;
}

/** The app's push row for a file that arrived from Teams, or whose copy in Teams was replaced: it is already there. */
export async function recordAsPushed(
  trx: Transaction<Database>,
  r: {
    jobId: string;
    fileId: string;
    itemId: string;
    eTag: string | null;
    name: string;
    remotePath: string;
    sizeBytes: number;
  },
  now: Date,
): Promise<void> {
  await trx
    .insertInto("teams_file_pushes")
    .values({
      file_id: r.fileId,
      job_id: r.jobId,
      status: "pushed",
      drive_item_id: r.itemId,
      etag: r.eTag,
      remote_name: r.name.slice(0, 255),
      remote_path: r.remotePath.slice(0, 800),
      size_bytes: r.sizeBytes,
      pushed_at: now,
      updated_at: now,
    })
    .onConflict((oc) =>
      oc.column("file_id").doUpdateSet({
        status: "pushed",
        drive_item_id: r.itemId,
        etag: r.eTag,
        error_code: null,
        updated_at: now,
      }),
    )
    .execute();
}

/** An edit in Teams superseded the app's copy: the old file row is soft-deleted and its push row retired. */
export async function retireReplacedFile(trx: Transaction<Database>, fileId: string, now: Date): Promise<void> {
  await trx
    .updateTable("files")
    .set({ deleted_at: now, deleted_reason: "teams_replaced" })
    .where("id", "=", fileId)
    .where("deleted_at", "is", null)
    .execute();
  await trx.deleteFrom("teams_file_pushes").where("file_id", "=", fileId).execute();
}

export async function markFileRemovedInTeams(trx: Transaction<Database>, fileId: string, now: Date): Promise<void> {
  await trx.updateTable("files").set({ teams_removed_at: now }).where("id", "=", fileId).execute();
  await trx
    .updateTable("teams_file_pushes")
    .set({ status: "deleted", updated_at: now })
    .where("file_id", "=", fileId)
    .execute();
}

export async function savePollState(db: Executor, jobId: string, token: string | null, now: Date): Promise<void> {
  await db
    .updateTable("job_teams_links")
    .set({ delta_token: token, last_poll_at: now })
    .where("job_id", "=", jobId)
    .execute();
}

export function fileTargetOf(
  db: Executor,
  fileId: string,
): Promise<
  { checkpoint_key: string | null; slot: string | null; condition_id: string | null; original_name: string } | undefined
> {
  return db
    .selectFrom("files")
    .select(["checkpoint_key", "slot", "condition_id", "original_name"])
    .where("id", "=", fileId)
    .executeTakeFirst();
}

/** Linked jobs whose inbound check is due: ready, last polled more than `pollSeconds` ago (or never), no poll queued. */
export async function jobsDueForPoll(db: Db, pollSeconds: number, now: Date, limit = 200): Promise<string[]> {
  const cutoff = new Date(now.getTime() - pollSeconds * 1000);
  const rows = await db
    .selectFrom("job_teams_links as l")
    .select("l.job_id")
    .where("l.status", "=", "ready")
    .where((eb) => eb.or([eb("l.last_poll_at", "is", null), eb("l.last_poll_at", "<", cutoff)]))
    .where((eb) =>
      eb.not(
        eb.exists(
          eb
            .selectFrom("operations as o")
            .select("o.id")
            .whereRef("o.job_id", "=", "l.job_id")
            .where("o.type", "=", "teams.poll")
            .where("o.status", "in", ["queued", "running"]),
        ),
      ),
    )
    .limit(limit)
    .execute();
  return rows.map((r) => r.job_id);
}

export async function queuePoll(db: Executor, jobId: string): Promise<string> {
  const op = await enqueueOperation(db, { jobId, type: "teams.poll", payload: {}, createdBy: null });
  return op.id;
}
