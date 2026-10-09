/** listAccessGrants, createAccessGrant and revokeAccessGrant (PRODUCT_SPEC §3.4, §6): the staff-only access manager. */
import type { FastifyInstance } from "fastify";
import { toAccessGrant } from "../../_shared/index.js";
import { audit, auditContext } from "../../../platform/audit.js";
import { requireCapability, resolveJobAccess } from "../../../platform/authz.js";
import { ConflictError } from "../../../platform/errors.js";
import { sendIdempotent, withIdempotency } from "../../../platform/idempotency.js";
import type { ModuleDeps } from "../../../platform/module.js";
import { defineRoute } from "../../../platform/routes.js";
import { findExternalAccountIds, findOpenGrant, insertGrant, isDuplicateGrant, userName } from "../data/grants.js";
import { duplicateGrantMessage, planGrant } from "../domain/grant-plan.js";

export function registerAccessRoutes(app: FastifyInstance, deps: ModuleDeps): void {
  defineRoute(app, "createAccessGrant", async ({ auth, request, reply, body }) => {
    requireCapability(auth, "access.manage");
    const { job } = await resolveJobAccess(deps.db, auth, body.jobId, "access.manage");
    const duplicate = () => new ConflictError({ detail: duplicateGrantMessage(body.email, job.job_number) });
    try {
      const result = await withIdempotency(
        deps.db,
        { request, userId: auth.user.id, operationId: "createAccessGrant", body, clock: deps.clock },
        async (trx) => {
          if (await findOpenGrant(trx, job.id, body.email)) throw duplicate();
          const now = deps.clock.now();
          const plan = planGrant(await findExternalAccountIds(trx, body.email), now);
          const row = await insertGrant(trx, {
            jobId: job.id,
            email: body.email,
            displayName: body.displayName ?? null,
            role: body.role,
            status: plan.status,
            userId: plan.userId,
            invitedBy: auth.user.id,
            at: now,
            activatedAt: plan.activatedAt,
          });
          await audit(trx, auditContext(request), {
            action: "access_grant.created",
            entityType: "access_grant",
            entityId: row.id,
            jobId: job.id,
            changes: {
              email: { from: null, to: row.email },
              role: { from: null, to: row.role },
              status: { from: null, to: row.status },
            },
          });
          const accountName = await userName(trx, row.user_id);
          return { status: 201, body: accessGrantView(row, job.job_number, accountName, auth.user.displayName) };
        },
      );
      return await sendIdempotent(reply, result);
    } catch (error) {
      if (isDuplicateGrant(error)) throw duplicate();
      throw error;
    }
  });
}

/** A grant as the access manager shows it: next to an Active grant, the name of the account it is bound to. */
function accessGrantView(
  row: Parameters<typeof toAccessGrant>[0],
  jobNumber: string,
  accountName: string | null,
  invitedByName: string | null,
) {
  return toAccessGrant(
    { ...row, display_name: accountName ?? row.display_name },
    {
      jobNumber,
      invitedBy:
        row.invited_by !== null && invitedByName !== null ? { id: row.invited_by, display_name: invitedByName } : null,
    },
  );
}
