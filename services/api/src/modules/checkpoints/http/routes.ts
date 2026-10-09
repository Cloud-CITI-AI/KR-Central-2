/** Checkpoint routes: updateCheckpoint now; recordDecision, markPaid and undoPaid follow. */
import type { FastifyInstance } from "fastify";
import { resolveJobAccess } from "../../../platform/authz.js";
import { setEtag } from "../../../platform/concurrency.js";
import { BadRequestError } from "../../../platform/errors.js";
import type { ModuleDeps } from "../../../platform/module.js";
import { defineRoute } from "../../../platform/routes.js";
import { capabilitiesForUpdate, hasNoteBox, planCheckpointUpdate } from "../domain/checkpoint-update.js";
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
}
