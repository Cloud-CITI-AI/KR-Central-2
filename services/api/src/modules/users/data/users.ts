/** users queries for administration (DATA_MODEL §3). */
import type { Database, Db, UserRow } from "@kr/db";
import type { GlobalRole } from "@kr/contracts";
import { sql, type Transaction } from "kysely";
import { containsPattern } from "../domain/user-view.js";

/** One page of users by display name then id; `afterId` is the last user of the previous page. */
export function listUserRows(
  db: Db,
  o: { q: string | undefined; role: GlobalRole | undefined; afterId: string | null; limit: number },
): Promise<UserRow[]> {
  let q = db.selectFrom("users").selectAll();
  if (o.q) {
    const pattern = containsPattern(o.q);
    q = q.where((eb) => eb.or([eb("display_name", "ilike", pattern), eb("email", "ilike", pattern)]));
  }
  if (o.role) q = q.where("role", "=", o.role);
  if (o.afterId !== null) {
    q = q.where(
      sql<boolean>`(users.display_name, users.id) > (select c.display_name, c.id from users c where c.id = ${o.afterId})`,
    );
  }
  return q
    .orderBy("display_name")
    .orderBy("id")
    .limit(o.limit + 1)
    .execute();
}

/**
 * Lock the target and every active admin in ONE statement, in id order: concurrent changes queue on the same rows in the
 * same order (no deadlock) and the loser re-reads the winner's result before it counts the admins that remain.
 */
export async function lockTargetAndAdmins(
  trx: Transaction<Database>,
  targetId: string,
): Promise<{ target: UserRow | undefined; otherActiveAdmins: number }> {
  const rows = await trx
    .selectFrom("users")
    .selectAll()
    .where((eb) => eb.or([eb("id", "=", targetId), eb.and([eb("role", "=", "admin"), eb("status", "=", "active")])]))
    .orderBy("id")
    .forUpdate()
    .execute();
  return {
    target: rows.find((r) => r.id === targetId),
    otherActiveAdmins: rows.filter((r) => r.id !== targetId && r.role === "admin" && r.status === "active").length,
  };
}

export function updateUserRow(
  trx: Transaction<Database>,
  target: Pick<UserRow, "id">,
  set: { role?: GlobalRole; status?: "active" | "disabled" },
): Promise<UserRow> {
  return trx
    .updateTable("users")
    .set({ ...set, version: sql<number>`version + 1` })
    .where("id", "=", target.id)
    .returningAll()
    .executeTakeFirstOrThrow();
}
