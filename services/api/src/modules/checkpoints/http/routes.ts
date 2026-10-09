/** Checkpoint routes (PRODUCT_SPEC §5.4, §5.5): updateCheckpoint, recordDecision, markPaid and undoPaid. */
import type { FastifyInstance } from "fastify";
import { resolveJobAccess } from "../../../platform/authz.js";
import { setEtag } from "../../../platform/concurrency.js";
import { BadRequestError, ConflictError } from "../../../platform/errors.js";
import type { ModuleDeps } from "../../../platform/module.js";
import { defineRoute } from "../../../platform/routes.js";
import {
  capabilitiesForUpdate,
  hasApprovalPanel,
  hasNoteBox,
  hasPaidPanel,
  planCheckpointUpdate,
  planDecision,
  planPaid,
  planUndoPaid,
} from "../domain/checkpoint-update.js";
import { applyCheckpointPlan, requireFeeProposalAccess } from "./apply-plan.js";

export function registerCheckpointRoutes(app: FastifyInstance, deps: ModuleDeps): void {
  defineRoute(app, "updateCheckpoint", async ({ auth, request, reply, params, body, expectedVersion }) => {
    // 404 for a job the caller cannot see, then 403 for every field they may not edit.
    const access = await resolveJobAccess(deps.db, auth, params.jobId, capabilitiesForUpdate(body));
    requireFeeProposalAccess(access, params.checkpointKey);
    if (body.krNote !== undefined && !hasNoteBox(params.checkpointKey)) {
      throw new BadRequestError({
        errors: [{ path: "krNote", message: "This checkpoint has no KR Surveys comment box." }],
      });
    }
    const state = await applyCheckpointPlan({
      deps,
      request,
      auth,
      access,
      checkpointKey: params.checkpointKey,
      expectedVersion,
      plan: (row) => planCheckpointUpdate(row, body),
    });
    setEtag(reply, state.version);
    return state;
  });

  defineRoute(app, "recordDecision", async ({ auth, request, params, body }) => {
    // The client's own grant, or staff acting on the client's behalf; architects have no decision capability.
    const access = await resolveJobAccess(deps.db, auth, params.jobId, "checkpoint.decision.record");
    requireFeeProposalAccess(access, params.checkpointKey);
    if (!hasApprovalPanel(params.checkpointKey)) {
      throw new ConflictError({ detail: "This checkpoint has no approval panel." });
    }
    // R14 (a declined decision needs a comment) is enforced by the contract schema and by the database CHECK.
    return applyCheckpointPlan({
      deps,
      request,
      auth,
      access,
      checkpointKey: params.checkpointKey,
      plan: (row) => planDecision(row, body, auth.user.id, deps.clock.now()),
    });
  });

  // R13: the client response button (INVOICE PAID, WORKS COMPLETE …) records the time and completes the checkpoint.
  defineRoute(app, "markPaid", async ({ auth, request, params }) => {
    const access = await resolveJobAccess(deps.db, auth, params.jobId, "checkpoint.paid.record");
    requireFeeProposalAccess(access, params.checkpointKey);
    if (!hasPaidPanel(params.checkpointKey)) {
      throw new ConflictError({ detail: "This checkpoint has no client response button." });
    }
    return applyCheckpointPlan({
      deps,
      request,
      auth,
      access,
      checkpointKey: params.checkpointKey,
      plan: (row) => planPaid(row, auth.user.id, deps.clock.now()),
    });
  });

  // Undo clears the response and sets Not completed; on a checkpoint that is not paid it changes nothing.
  defineRoute(app, "undoPaid", async ({ auth, request, params }) => {
    const access = await resolveJobAccess(deps.db, auth, params.jobId, "checkpoint.paid.record");
    requireFeeProposalAccess(access, params.checkpointKey);
    return applyCheckpointPlan({
      deps,
      request,
      auth,
      access,
      checkpointKey: params.checkpointKey,
      plan: (row) => planUndoPaid(row),
    });
  });
}
