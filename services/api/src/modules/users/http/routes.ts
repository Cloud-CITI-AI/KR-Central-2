/** listUsers and updateUser (PRODUCT_SPEC §9.1): administration of roles and access, for admins with MFA evidence. */
import type { FastifyInstance } from "fastify";
import { assertMfaForAdmin, requireCapability } from "../../../platform/authz.js";
import { BadRequestError } from "../../../platform/errors.js";
import type { ModuleDeps } from "../../../platform/module.js";
import { defineRoute } from "../../../platform/routes.js";
import { listUserRows } from "../data/users.js";
import { decodeUserCursor, encodeUserCursor } from "../domain/cursor.js";
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
}
