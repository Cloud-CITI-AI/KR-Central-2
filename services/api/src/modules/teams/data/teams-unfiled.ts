/** Unfiled items (phase 2) and the delete-propagation hook (BE-7: Kysely only). */
import { enqueueOperation, type Database, type Db, type TeamsInboundItemRow } from "@kr/db";
import type { Transaction } from "kysely";

type Executor = Db | Transaction<Database>;

export function listUnfiled(db: Executor, jobId: string): Promise<TeamsInboundItemRow[]> {
  return db
    .selectFrom("teams_inbound_items")
    .selectAll()
    .where("job_id", "=", jobId)
    .where("status", "=", "unfiled")
    .orderBy("seen_at")
    .execute();
}

export function countUnfiled(db: Executor, jobId: string): Promise<number> {
  return db
    .selectFrom("teams_inbound_items")
    .select((eb) => eb.fn.countAll<string>().as("n"))
    .where("job_id", "=", jobId)
    .where("status", "=", "unfiled")
    .executeTakeFirstOrThrow()
    .then((r) => Number(r.n));
}

export function findUnfiled(
  db: Executor,
  jobId: string,
  itemId: string,
  lock = false,
): Promise<TeamsInboundItemRow | undefined> {
  let q = db
    .selectFrom("teams_inbound_items")
    .selectAll()
    .where("job_id", "=", jobId)
    .where("drive_item_id", "=", itemId);
  if (lock) q = q.forUpdate();
  return q.executeTakeFirst();
}

export async function markUnfiled(
  trx: Transaction<Database>,
  jobId: string,
  itemId: string,
  status: "dismissed" | "importing",
  now: Date,
): Promise<void> {
  await trx
    .updateTable("teams_inbound_items")
    .set({ status, updated_at: now, error_code: null })
    .where("job_id", "=", jobId)
    .where("drive_item_id", "=", itemId)
    .execute();
}

/** Queues a `teams.poll` carrying the filing instruction (the worker imports exactly that item). */
export async function queueImport(
  trx: Transaction<Database>,
  jobId: string,
  itemId: string,
  target: { checkpointKey: string; slot: string } | { conditionId: string },
  createdBy: string,
): Promise<string> {
  const op = await enqueueOperation(trx, {
    jobId,
    type: "teams.poll",
    payload: { import: { itemId, ...target } },
    createdBy,
  });
  return op.id;
}

/**
 * The delete-propagation hook (ADR-0015 A4): when the deleted file has a copy in Teams, mark it `deleting` and queue
 * a push; the worker removes the item only while its eTag matches. Nothing happens for files never copied.
 */
export async function queueTeamsDelete(
  trx: Transaction<Database>,
  fileId: string,
  jobId: string,
  now: Date,
): Promise<boolean> {
  const r = await trx
    .updateTable("teams_file_pushes")
    .set({ status: "deleting", updated_at: now })
    .where("file_id", "=", fileId)
    .where("status", "=", "pushed")
    .where("drive_item_id", "is not", null)
    .executeTakeFirst();
  if (r.numUpdatedRows === 0n) return false;
  const existing = await trx
    .selectFrom("operations")
    .select("id")
    .where("job_id", "=", jobId)
    .where("type", "=", "teams.push")
    .where("status", "in", ["queued", "running"])
    .executeTakeFirst();
  if (!existing) await enqueueOperation(trx, { jobId, type: "teams.push", payload: {}, createdBy: null });
  return true;
}
