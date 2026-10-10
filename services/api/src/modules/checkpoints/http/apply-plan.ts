/** The one write path of the checkpoints module: lock, check the version, apply a plan, audit, answer. */
import type { CheckpointState } from "@kr/contracts";
import type { CheckpointStateRow } from "@kr/db";
import { getCheckpoint } from "@kr/workflow";
import type { FastifyRequest } from "fastify";
import { audit, auditContext, withTransaction } from "../../../platform/audit.js";
import type { AuthContext } from "../../../platform/auth-context.js";
import { requireJobCapability, type JobAccess } from "../../../platform/authz.js";
import { assertVersion } from "../../../platform/concurrency.js";
import { NotFoundError } from "../../../platform/errors.js";
import type { ModuleDeps } from "../../../platform/module.js";
import { touchJob, loadCheckpointView } from "../../jobs/index.js";
import { lockCheckpointState, writeCheckpointState } from "../data/checkpoint-states.js";
import type { CheckpointPlan } from "../domain/checkpoint-update.js";

/** The fee proposal's panel content is for fee_proposal.view holders only (contract authz of every checkpoint write). */
export function requireFeeProposalAccess(access: Pick<JobAccess, "capabilities">, checkpointKey: string): void {
  if (getCheckpoint(checkpointKey).restricted === "fee_proposal") requireJobCapability(access, "fee_proposal.view");
}

export interface ApplyOptions {
  readonly deps: ModuleDeps;
  readonly request: FastifyRequest;
  readonly auth: AuthContext;
  readonly access: JobAccess;
  readonly checkpointKey: string;
  /** Present for If-Match routes (updateCheckpoint); the decision and paid endpoints are idempotent PUT/DELETE without one. */
  readonly expectedVersion?: number | undefined;
  readonly plan: (row: CheckpointStateRow) => CheckpointPlan;
}

export function applyCheckpointPlan(o: ApplyOptions): Promise<CheckpointState> {
  const { deps, access, checkpointKey } = o;
  const jobId = access.job.id;
  return withTransaction(deps.db, async (trx) => {
    const row = await lockCheckpointState(trx, jobId, checkpointKey);
    if (!row) throw new NotFoundError();
    if (o.expectedVersion !== undefined) assertVersion(row.version, o.expectedVersion);
    const plan = o.plan(row);
    if (!plan.isNoOp) {
      await touchJob(trx, jobId);
      await writeCheckpointState(trx, row, plan.set, o.auth.user.id);
      for (const a of plan.audits) {
        await audit(trx, auditContext(o.request), {
          action: a.action,
          entityType: "checkpoint",
          entityId: checkpointKey,
          jobId,
          changes: a.changes,
        });
      }
    }
    const viewer = { id: o.auth.user.id, capabilities: access.capabilities, grantRole: access.grantRole };
    return loadCheckpointView(trx, jobId, checkpointKey, viewer);
  });
}
