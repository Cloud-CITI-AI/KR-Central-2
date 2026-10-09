/** Statements of the hourly sweeps (BE-7: Kysely or parameterised SQL only). The app role's statement timeout is 15 s, so work is batched. */
import { recordAudit, type Db } from "@kr/db";
import type { Logger } from "@kr/logger";
import type { ObjectStorage } from "@kr/storage";
import { sql, type RawBuilder } from "kysely";
import { describeError } from "../errors.js";
import type { Cutoffs } from "../domain/retention.js";

const BATCH = 1000;
const MAX_BATCHES = 50;

type SweptTable = "sessions" | "auth_flows" | "idempotency_keys" | "rate_limits";

/** Deletes the rows of `table` matching `condition`, `BATCH` at a time (the tables have different primary keys, so by ctid). */
async function deleteInBatches(db: Db, table: SweptTable, condition: RawBuilder<boolean>): Promise<number> {
  let total = 0;
  for (let batch = 0; batch < MAX_BATCHES; batch += 1) {
    const result = await sql`
      delete from ${sql.table(table)}
       where ctid in (select ctid from ${sql.table(table)} where ${condition} limit ${BATCH})`.execute(db);
    const deleted = Number(result.numAffectedRows ?? 0n);
    total += deleted;
    if (deleted < BATCH) break;
  }
  return total;
}

/** Sessions (7 days after they ended), sign-in flows, idempotency keys and rate-limit rows past their expiry. */
export async function deleteExpiredRows(db: Db, c: Cutoffs): Promise<Record<SweptTable, number>> {
  return {
    sessions: await deleteInBatches(
      db,
      "sessions",
      sql<boolean>`least(idle_expires_at, absolute_expires_at) < ${c.sessionsEndedBefore} or revoked_at < ${c.sessionsEndedBefore}`,
    ),
    auth_flows: await deleteInBatches(db, "auth_flows", sql<boolean>`expires_at < ${c.authFlowsExpiredBefore}`),
    idempotency_keys: await deleteInBatches(
      db,
      "idempotency_keys",
      sql<boolean>`created_at < ${c.idempotencyCreatedBefore}`,
    ),
    rate_limits: await deleteInBatches(
      db,
      "rate_limits",
      sql<boolean>`expire is not null and expire < ${c.rateLimitsExpiredBeforeMs}`,
    ),
  };
}

const PURGE_BATCH = 200;

/**
 * Deletes the object of every file soft-deleted before the cut-off and marks the row `purged_at`, with one system audit row
 * (ids only). The object goes first: if it cannot be deleted the row stays unpurged and the next sweep tries again; a file that
 * fails is skipped for the rest of this sweep so it cannot hold up the others.
 */
export async function purgeDeletedFiles(
  db: Db,
  storage: ObjectStorage,
  c: Cutoffs,
  log: Logger,
): Promise<{ purged: number; failed: number }> {
  const failed: string[] = [];
  let purged = 0;
  for (let batch = 0; batch < MAX_BATCHES; batch += 1) {
    let query = db
      .selectFrom("files")
      .select(["id", "job_id", "storage_key"])
      .where("deleted_at", "<", c.filesDeletedBefore)
      .where("purged_at", "is", null)
      .orderBy("deleted_at")
      .limit(PURGE_BATCH);
    if (failed.length > 0) query = query.where("id", "not in", failed);
    const files = await query.execute();
    for (const file of files) {
      try {
        await storage.delete(file.storage_key);
        await db.transaction().execute(async (trx) => {
          await trx.updateTable("files").set({ purged_at: c.now }).where("id", "=", file.id).execute();
          await recordAudit(trx, {
            actorUserId: null,
            action: "file.purged",
            entityType: "file",
            entityId: file.id,
            jobId: file.job_id,
          });
        });
        purged += 1;
      } catch (err) {
        failed.push(file.id);
        log.warn(
          { event: "purge_failed", fileId: file.id, ...describeError(err) },
          "A deleted file could not be purged; it is retried next sweep",
        );
      }
    }
    if (files.length < PURGE_BATCH) break;
  }
  return { purged, failed: failed.length };
}
