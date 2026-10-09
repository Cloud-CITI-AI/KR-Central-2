/** listUsers and updateUser (PRODUCT_SPEC §9.1): administration of roles and access, for admins with MFA evidence. */
import type { FastifyInstance } from "fastify";
import { audit, auditContext, withTransaction } from "../../../platform/audit.js";
import { assertMfaForAdmin, requireCapability } from "../../../platform/authz.js";
import { assertVersion, setEtag } from "../../../platform/concurrency.js";
import { BadRequestError, NotFoundError } from "../../../platform/errors.js";
import type { ModuleDeps } from "../../../platform/module.js";
import { defineRoute } from "../../../platform/routes.js";
import { revokeAllForUser } from "../../../platform/session.js";
import { listUserRows, lockTargetAndAdmins, updateUserRow } from "../data/users.js";
import { decodeUserCursor, encodeUserCursor } from "../domain/cursor.js";
import { planUserUpdate } from "../domain/user-update.js";
import { toUser } from "../domain/user-view.js";

export function registerUserRoutes(app: FastifyInstance, deps: ModuleDeps): void {
  defineRoute(app, "listUsers", async ({ auth, query }) => {
    requireCapability(auth, "users.manage");
    assertMfaForAdmin(auth, deps.config);
    const after = query.cursor === undefined ? null : decodeUserCursor(query.cursor);
    if (query.cursor !== undefined && after === null) throw new BadRequestError({ detail: "The cursor is not valid." });
    const rows = await listUserRows(deps.db, { q: query.q, role: query.role, afterId: after, limit: query.limit });
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return {
      items: page.map(toUser),
      nextCursor: rows.length > query.limit && last ? encodeUserCursor(last.id) : null,
    };
  });

  defineRoute(app, "updateUser", async ({ auth, request, reply, params, body, expectedVersion }) => {
    requireCapability(auth, "users.manage");
    assertMfaForAdmin(auth, deps.config);
    // If-Match is optional on this route (contract): the platform parses it when sent (malformed 400), never requires it; stale is 412.
    const updated = await withTransaction(deps.db, async (trx) => {
      const { target, otherActiveAdmins } = await lockTargetAndAdmins(trx, params.userId);
      if (!target) throw new NotFoundError();
      if (expectedVersion !== undefined) assertVersion(target.version, expectedVersion);
      const plan = planUserUpdate(
        auth.user.id,
        { id: target.id, role: target.role, status: target.status, isGuest: target.is_guest },
        body,
        otherActiveAdmins,
      );
      if (plan.isNoOp) return target;
      const row = await updateUserRow(trx, target, plan.set);
      await revokeAllForUser(trx, target.id, plan.revokeReason, deps.clock);
      for (const c of plan.changes) {
        await audit(trx, auditContext(request), {
          action: `user.${c.field}_changed`,
          entityType: "user",
          entityId: target.id,
          changes: { [c.field]: { from: c.from, to: c.to } },
        });
      }
      return row;
    });
    setEtag(reply, updated.version);
    return toUser(updated);
  });
}
