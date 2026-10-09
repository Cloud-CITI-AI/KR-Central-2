/** Statements of the hourly sweeps (BE-7: Kysely or parameterised SQL only). The app role's statement timeout is 15 s, so work is batched. */
import type { Db } from "@kr/db";
import { sql, type RawBuilder } from "kysely";
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
