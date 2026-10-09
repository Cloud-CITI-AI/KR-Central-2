/** listAuditEvents (PRODUCT_SPEC §9.2): the read-only audit trail for admin and kr_admin, with MFA evidence. */
import type { FastifyInstance } from "fastify";
import { toAuditEvent } from "../../_shared/index.js";
import { assertMfaForAdmin, requireCapability } from "../../../platform/authz.js";
import { BadRequestError } from "../../../platform/errors.js";
import type { ModuleDeps } from "../../../platform/module.js";
import { defineRoute } from "../../../platform/routes.js";
import { listAuditRows } from "../data/audit-events.js";
import { decodeAuditCursor, encodeAuditCursor, occurredRange } from "../domain/audit-filters.js";

export function registerAuditRoutes(app: FastifyInstance, deps: ModuleDeps): void {
  defineRoute(app, "listAuditEvents", async ({ auth, query }) => {
    requireCapability(auth, "audit.read");
    assertMfaForAdmin(auth, deps.config);
    const beforeId = query.cursor === undefined ? null : decodeAuditCursor(query.cursor);
    if (query.cursor !== undefined && beforeId === null)
      throw new BadRequestError({ detail: "The cursor is not valid." });
    const range = occurredRange(query.from, query.to);
    // The contract already rejects a reversed range; this is the second line of defence.
    if (range === null) throw new BadRequestError({ detail: "The date range is not valid." });
    const rows = await listAuditRows(deps.db, {
      jobId: query.jobId,
      actorId: query.actorId,
      actionPrefix: query.action,
      range,
      beforeId,
      limit: query.limit,
    });
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return {
      items: page.map(({ row, actorName }) =>
        toAuditEvent(
          row,
          row.actor_user_id !== null && actorName !== null ? { id: row.actor_user_id, display_name: actorName } : null,
        ),
      ),
      nextCursor: rows.length > query.limit && last ? encodeAuditCursor(last.row.id) : null,
    };
  });
}
