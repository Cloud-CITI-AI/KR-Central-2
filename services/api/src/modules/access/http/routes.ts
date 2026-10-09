/** listAccessGrants, createAccessGrant and revokeAccessGrant (PRODUCT_SPEC §3.4, §6): the staff-only access manager. */
import type { AccessGrantRow } from "@kr/db";
import type { FastifyInstance } from "fastify";
import { toAccessGrant } from "../../_shared/index.js";
import { audit, auditContext, withTransaction } from "../../../platform/audit.js";
import { requireCapability, resolveJobAccess } from "../../../platform/authz.js";
import { BadRequestError, ConflictError, NotFoundError } from "../../../platform/errors.js";
import { sendIdempotent, withIdempotency } from "../../../platform/idempotency.js";
import type { ModuleDeps } from "../../../platform/module.js";
import { defineRoute } from "../../../platform/routes.js";
import {
  findExternalAccountIds,
  findOpenGrant,
  insertGrant,
  isDuplicateGrant,
  listGrantRows,
  lockGrant,
  recordInvitation,
  revokeGrantRow,
  userName,
} from "../data/grants.js";
import { decodeGrantCursor, encodeGrantCursor } from "../domain/cursor.js";
import { duplicateGrantMessage, planGrant } from "../domain/grant-plan.js";
import { invitationErrorText, type GuestInviter } from "../domain/guest-inviter.js";

export function registerAccessRoutes(app: FastifyInstance, deps: ModuleDeps, inviter: GuestInviter): void {
  defineRoute(app, "listAccessGrants", async ({ auth, query }) => {
    requireCapability(auth, "access.manage");
    const after = query.cursor === undefined ? null : decodeGrantCursor(query.cursor);
    if (query.cursor !== undefined && after === null) throw new BadRequestError({ detail: "The cursor is not valid." });
    const rows = await listGrantRows(deps.db, {
      jobId: query.jobId,
      status: query.status,
      afterId: after,
      limit: query.limit,
    });
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return {
      items: page.map((r) => accessGrantView(r.row, r.jobNumber, r.accountName, r.invitedByName)),
      nextCursor: rows.length > query.limit && last ? encodeGrantCursor(last.row.id) : null,
    };
  });

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
          const invite = async (grant: AccessGrantRow): Promise<AccessGrantRow> => {
            if (grant.status !== "pending" || !deps.flags.isEnabled("entra-guest-invites")) return grant;
            const failure = await inviter
              .invite({ email: grant.email, displayName: grant.display_name, redirectUrl: deps.config.PUBLIC_BASE_URL })
              .then(
                () => null,
                (error: unknown) => invitationErrorText(error),
              );
            if (failure !== null)
              deps.log.warn({ event: "guest_invitation_failed", grantId: grant.id }, "Guest invitation failed");
            const status = failure === null ? "sent" : "failed";
            await recordInvitation(trx, grant.id, status, failure);
            await audit(trx, auditContext(request), {
              action: `access_grant.invitation_${status}`,
              entityType: "access_grant",
              entityId: grant.id,
              jobId: job.id,
              changes: { invitationStatus: { from: "not_sent", to: status } },
            });
            return { ...grant, invitation_status: status, invitation_error: failure };
          };
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
          // A grant bound to an existing account needs no invitation. A failed invitation never fails the grant.
          const invited = await invite(row);
          const accountName = await userName(trx, row.user_id);
          return { status: 201, body: accessGrantView(invited, job.job_number, accountName, auth.user.displayName) };
        },
      );
      return await sendIdempotent(reply, result);
    } catch (error) {
      if (isDuplicateGrant(error)) throw duplicate();
      throw error;
    }
  });

  // Revoking is idempotent. Job visibility is evaluated on every request, so the user loses access on their next call.
  defineRoute(app, "revokeAccessGrant", async ({ auth, request, reply, params }) => {
    requireCapability(auth, "access.manage");
    await withTransaction(deps.db, async (trx) => {
      const grant = await lockGrant(trx, params.grantId);
      if (!grant) throw new NotFoundError();
      if (grant.status === "revoked") return;
      await revokeGrantRow(trx, grant.id, auth.user.id, deps.clock.now());
      await audit(trx, auditContext(request), {
        action: "access_grant.revoked",
        entityType: "access_grant",
        entityId: grant.id,
        jobId: grant.job_id,
        changes: { status: { from: grant.status, to: "revoked" } },
      });
    });
    return reply.code(204).send();
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
