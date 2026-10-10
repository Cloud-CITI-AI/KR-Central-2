/**
 * Provisioning at sign-in: ONE transaction that finds or creates the user, claims the first-admin bootstrap, activates
 * pending grants and writes the audit events (PRODUCT_SPEC §3.1 steps 4 and 6, §3.3, §3.4). Sessions are created after
 * it commits, by the caller.
 */
import type { Database, Db, UserRow } from "@kr/db";
import { sql, type Transaction } from "kysely";
import { audit, type AuditContext } from "../../../platform/audit.js";
import { revokeAllForUser } from "../../../platform/session.js";
import type { Identity } from "../domain/claims.js";
import { assignRole, isFirstAdminEligible } from "../domain/roles.js";
import { claimFirstAdmin } from "./bootstrap.js";
import { activateGrants, countActivatableGrants, countActiveGrantsOf } from "./grants.js";

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
      readonly grantsActivated: number;
    }
  | { readonly ok: false; readonly reason: "disabled" | "unverified_email" };

/** Thrown inside the transaction to roll everything back (user, grants, audit) with a reason for the user. */
class SignInRefused extends Error {
  constructor(readonly reason: "unverified_email") {
    super(reason);
  }
}

/**
 * Upsert the user by (tid, oid) with the current name, guest flag and email; only a new user gets a role from the
 * token. A disabled user matches the conflict but the `status = 'active'` guard makes the statement touch nothing, so it
 * returns no row. `demote` is set for a stored member whose token now says guest: the same statement moves them to
 * `external` (ADR-0014: guests always have the global role external), so no state exists where is_guest and a staff or
 * admin role coexist.
 */
async function upsertUser(trx: Transaction<Database>, id: Identity, policy: SignInPolicy, demote: boolean) {
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
      email_verified: id.emailVerified,
      last_sign_in_at: policy.now,
    })
    .onConflict((oc) =>
      oc
        .columns(["entra_tenant_id", "entra_object_id"])
        .doUpdateSet({
          email: id.email,
          display_name: id.displayName,
          is_guest: id.isGuest,
          email_verified: id.emailVerified,
          last_sign_in_at: policy.now,
          ...(demote ? { role: "external" as const, version: sql<number>`users.version + 1` } : {}),
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

/** Lock the stored row (if any) so a concurrent sign-in cannot read the same "before" state. */
async function lockStoredUser(trx: Transaction<Database>, id: Identity) {
  return trx
    .selectFrom("users")
    .select(["role", "is_guest", "status"])
    .where("entra_tenant_id", "=", id.tid)
    .where("entra_object_id", "=", id.oid)
    .forUpdate()
    .executeTakeFirst();
}

async function provision(trx: Transaction<Database>, id: Identity, policy: SignInPolicy): Promise<Provisioned> {
  const stored = await lockStoredUser(trx, id);
  const demotedFrom = stored?.status === "active" && !stored.is_guest && id.isGuest ? stored.role : undefined;
  const demoted = demotedFrom !== undefined;
  const upserted = await upsertUser(trx, id, policy, demoted);
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

  if (demoted) {
    await audit(trx, ctx, {
      action: "user.role_changed",
      entityType: "user",
      entityId: user.id,
      changes: { role: { from: demotedFrom, to: user.role }, is_guest: { from: false, to: true } },
    });
    // Sessions opened while this was a member still carry its capabilities; the new session is created after commit.
    await revokeAllForUser(trx, user.id, "role_changed", { now: () => policy.now });
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

  // An account whose email the IdP does not vouch for (xms_edov=false) may not use grants: refuse and say why. One
  // bound while the email was verified stays bound to the user id, but this sign-in must not reach it, so the
  // refusal is committed together with the end of every session of the user (and the flag above, which keeps new
  // grants from binding).
  if (!id.emailVerified && (await countActiveGrantsOf(trx, user.id)) > 0) {
    await revokeAllForUser(trx, user.id, "role_changed", { now: () => policy.now });
    await audit(trx, ctx, {
      action: "auth.signin_refused",
      entityType: "user",
      entityId: user.id,
      changes: { reason: { from: null, to: "unverified_email" } },
    });
    return { ok: false, reason: "unverified_email" };
  }

  let grantsActivated = 0;
  if (id.email !== null) {
    // Grants are matched on the email only when the IdP vouches for its domain (xms_edov); otherwise refuse and say why.
    if (!id.emailVerified && (await countActivatableGrants(trx, id.email)) > 0)
      throw new SignInRefused("unverified_email");
    for (const grant of await activateGrants(trx, id.email, user.id, policy.now)) {
      grantsActivated += 1;
      await audit(trx, ctx, {
        action: "grant.activated",
        entityType: "access_grant",
        entityId: grant.id,
        jobId: grant.job_id,
        changes: { status: { from: "pending", to: "active" }, user_id: { from: null, to: user.id } },
      });
    }
  }

  await audit(trx, ctx, { action: "auth.signin", entityType: "user", entityId: user.id });
  return { ok: true, user, created: upserted.created, firstAdmin, grantsActivated };
}

export async function provisionSignIn(db: Db, id: Identity, policy: SignInPolicy): Promise<Provisioned> {
  try {
    return await db.transaction().execute((trx) => provision(trx, id, policy));
  } catch (err) {
    if (err instanceof SignInRefused) return { ok: false, reason: err.reason };
    throw err;
  }
}
