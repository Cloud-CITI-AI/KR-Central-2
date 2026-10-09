/** users queries for administration (DATA_MODEL §3). */
import type { Db, UserRow } from "@kr/db";
import type { GlobalRole } from "@kr/contracts";
import { sql } from "kysely";
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
