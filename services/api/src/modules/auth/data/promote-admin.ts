/** Operator recovery (ADR-0003): promote an existing tenant member to admin, audited as the system actor. */
import type { Db } from "@kr/db";
import { sql } from "kysely";
import { audit } from "../../../platform/audit.js";
import type { Clock } from "../../../platform/module.js";
import { revokeAllForUser } from "../../../platform/session.js";
import { claimFirstAdmin } from "./bootstrap.js";

export type PromoteResult =
  | { readonly status: "promoted"; readonly userId: string; readonly previousRole: string }
  | { readonly status: "already_admin"; readonly userId: string }
  | { readonly status: "not_found" | "guest" | "disabled" | "ambiguous" };

/**
 * Promote the one active, non-guest user with this email (case-insensitive). Refuses guests (B2B accounts are never
 * admins), disabled users, unknown addresses and an address shared by several members. The user's sessions are revoked
 * so the new role is picked up at the next sign-in (privilege change, PRODUCT_SPEC §2). The bootstrap row is claimed too:
 * once an operator has named an admin, no later first sign-in may become one automatically (ADR-0003).
 */
export async function promoteAdmin(db: Db, email: string, clock: Clock): Promise<PromoteResult> {
  return db.transaction().execute(async (trx): Promise<PromoteResult> => {
    const users = await trx
      .selectFrom("users")
      .select(["id", "role", "is_guest", "status"])
      .where("email", "=", email)
      .execute();
    const members = users.filter((u) => !u.is_guest);
    if (users.length === 0) return { status: "not_found" };
    if (members.length === 0) return { status: "guest" };
    const active = members.filter((u) => u.status === "active");
    if (active.length === 0) return { status: "disabled" };
    const [user, ...others] = active;
    if (user === undefined || others.length > 0) return { status: "ambiguous" };
    if (user.role === "admin") return { status: "already_admin", userId: user.id };

    await trx
      .updateTable("users")
      .set({ role: "admin", version: sql<number>`version + 1` })
      .where("id", "=", user.id)
      .execute();
    await claimFirstAdmin(trx, user.id);
    await revokeAllForUser(trx, user.id, "role_changed", clock);
    await audit(
      trx,
      { actorUserId: null, requestId: "cli:promote-admin" },
      {
        action: "user.role_changed",
        entityType: "user",
        entityId: user.id,
        changes: { role: { from: user.role, to: "admin" } },
      },
    );
    return { status: "promoted", userId: user.id, previousRole: user.role };
  });
}
