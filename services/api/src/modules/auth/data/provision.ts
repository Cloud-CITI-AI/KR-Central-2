/**
 * Provisioning at sign-in: ONE transaction that finds or creates the user, claims the first-admin bootstrap
 * and writes the audit events (PRODUCT_SPEC §3.1 step 4, §3.3); grants follow in the next PR. Sessions are created after
 * it commits, by the caller.
 */
import type { Database, Db, UserRow } from "@kr/db";
import { sql, type Transaction } from "kysely";
import { audit, type AuditContext } from "../../../platform/audit.js";
import type { Identity } from "../domain/claims.js";
import { assignRole, isFirstAdminEligible } from "../domain/roles.js";
import { claimFirstAdmin } from "./bootstrap.js";

export interface SignInPolicy {
  readonly now: Date;
  readonly staffDomains: readonly string[];
  readonly requestId: string;
}

export type Provisioned =
  | {
      readonly ok: true;
      readonly user: UserRow;
      readonly created: boolean;
      readonly firstAdmin: boolean;
    }
  | { readonly ok: false; readonly reason: "disabled" };

/**
 * Upsert the user by (tid, oid) with the current name, guest flag and email; only a new user gets a role. A disabled
 * user matches the conflict but the `status = 'active'` guard makes the statement touch nothing, so it returns no row.
 */
async function upsertUser(trx: Transaction<Database>, id: Identity, policy: SignInPolicy) {
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
  if (row === undefined) return undefined;
  const { created, ...user } = row;
  return { user, created };
}

async function provision(trx: Transaction<Database>, id: Identity, policy: SignInPolicy): Promise<Provisioned> {
  const upserted = await upsertUser(trx, id, policy);
  if (upserted === undefined) return { ok: false, reason: "disabled" };
  let user = upserted.user;
  const ctx: AuditContext = { actorUserId: user.id, requestId: policy.requestId };

  if (upserted.created) {
    await audit(trx, ctx, {
      action: "user.created",
      entityType: "user",
      entityId: user.id,
      changes: { role: { from: null, to: user.role }, is_guest: { from: null, to: user.is_guest } },
    });
  }

  const firstAdmin =
    isFirstAdminEligible({ isGuest: user.is_guest, role: user.role }) && (await claimFirstAdmin(trx, user.id));
  if (firstAdmin) {
    user = await trx
      .updateTable("users")
      .set({ role: "admin", version: sql<number>`version + 1` })
      .where("id", "=", user.id)
      .returningAll()
      .executeTakeFirstOrThrow();
    await audit(trx, ctx, {
      action: "user.first_admin_assigned",
      entityType: "user",
      entityId: user.id,
      changes: { role: { from: "staff", to: "admin" } },
    });
  }

  await audit(trx, ctx, { action: "auth.signin", entityType: "user", entityId: user.id });
  return { ok: true, user, created: upserted.created, firstAdmin };
}

export function provisionSignIn(db: Db, id: Identity, policy: SignInPolicy): Promise<Provisioned> {
  return db.transaction().execute((trx) => provision(trx, id, policy));
}
