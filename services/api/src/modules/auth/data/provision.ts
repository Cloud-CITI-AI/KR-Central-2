/** Provisioning at sign-in: one transaction that finds or creates the user (PRODUCT_SPEC §3.1 step 4). */
import type { Database, Db, UserRow } from "@kr/db";
import { sql, type Transaction } from "kysely";
import type { Identity } from "../domain/claims.js";
import { assignRole } from "../domain/roles.js";

export interface SignInPolicy {
  readonly now: Date;
  readonly staffDomains: readonly string[];
}

export type Provisioned =
  | { readonly ok: true; readonly user: UserRow; readonly created: boolean }
  | { readonly ok: false; readonly reason: "disabled" };

/**
 * Upsert the user by (tid, oid) with the current name, guest flag and email; only a new user gets a role. A disabled
 * user matches the conflict but the `status = 'active'` guard makes the statement touch nothing, so it returns no row.
 */
async function upsertUser(trx: Transaction<Database>, id: Identity, policy: SignInPolicy): Promise<Provisioned> {
  const role = assignRole({ isGuest: id.isGuest, email: id.email, staffDomains: policy.staffDomains });
  const row = await trx
    .insertInto("users")
    .values({
      entra_tenant_id: id.tid,
      entra_object_id: id.oid,
      email: id.email,
      display_name: id.displayName,
      role,
      is_guest: id.isGuest,
      last_sign_in_at: policy.now,
    })
    .onConflict((oc) =>
      oc
        .columns(["entra_tenant_id", "entra_object_id"])
        .doUpdateSet({
          email: id.email,
          display_name: id.displayName,
          is_guest: id.isGuest,
          last_sign_in_at: policy.now,
        })
        .where("users.status", "=", "active"),
    )
    .returningAll()
    .returning(sql<boolean>`(xmax = 0)`.as("created"))
    .executeTakeFirst();
  if (row === undefined) return { ok: false, reason: "disabled" };
  const { created, ...user } = row;
  return { ok: true, user, created };
}

export function provisionSignIn(db: Db, id: Identity, policy: SignInPolicy): Promise<Provisioned> {
  return db.transaction().execute((trx) => upsertUser(trx, id, policy));
}
