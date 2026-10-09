/** The first-admin bootstrap row (`system_bootstrap`, ADR-0003): one row ever, claimed by exactly one transaction. */
import type { Database } from "@kr/db";
import type { Transaction } from "kysely";

/**
 * `INSERT ... ON CONFLICT DO NOTHING RETURNING`: the singleton primary key lets concurrent first sign-ins race safely
 * without an application lock. Only the transaction that gets a row back may promote its user; a concurrent loser waits
 * for the winner to commit and then gets nothing (and wins instead if the winner rolls back).
 */
export async function claimFirstAdmin(trx: Transaction<Database>, userId: string): Promise<boolean> {
  const row = await trx
    .insertInto("system_bootstrap")
    .values({ first_admin_user_id: userId })
    .onConflict((oc) => oc.doNothing())
    .returning("first_admin_user_id")
    .executeTakeFirst();
  return row !== undefined;
}
