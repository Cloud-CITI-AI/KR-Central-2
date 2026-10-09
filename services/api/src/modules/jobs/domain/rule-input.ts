/**
 * Database rows -> the input of the @kr/workflow rules (R1..R15 are computed there, once; this file only maps).
 * Pure: callers load the rows. The fee proposal (PRODUCT_SPEC §5.4, developer note 2) is the one place where what a
 * caller may see changes what is computed: a viewer without `fee_proposal.view` must not learn the client's decision
 * through a derived alert, so the decision of a restricted checkpoint is left out of their rule input.
 */
import type { JobCapability } from "@kr/contracts";
import type { CheckpointStateRow, ConditionRow, JobRow } from "@kr/db";
import {
  AGENCIES,
  getCheckpoint,
  isCheckpointKey,
  type Agency,
  type CheckpointStateInput,
  type ConditionInput,
  type JobRuleInput,
} from "@kr/workflow";

export type StateRowForRules = Pick<CheckpointStateRow, "checkpoint_key" | "status" | "responsibility" | "decision">;
export type ConditionRowForRules = Pick<ConditionRow, "agency" | "agency_guessed" | "is_cleared">;
export type JobRowForRules = Pick<JobRow, "approval_expiry" | "outcome_date">;

/** True when the caller may see the fee proposal's panel content (decision, note, files). */
export function canViewFeeProposal(capabilities: readonly JobCapability[]): boolean {
  return capabilities.includes("fee_proposal.view");
}

/** A checkpoint whose panel content is hidden from this viewer. */
export function isRestrictedFor(checkpointKey: string, viewerCanViewFeeProposal: boolean): boolean {
  return (
    !viewerCanViewFeeProposal &&
    isCheckpointKey(checkpointKey) &&
    getCheckpoint(checkpointKey).restricted === "fee_proposal"
  );
}

function isAgency(value: string): value is Agency {
  return (AGENCIES as readonly string[]).includes(value);
}

export function toConditionInput(row: ConditionRowForRules): ConditionInput {
  // The database CHECK keeps this list closed; a value outside it is a schema/workflow mismatch, never user input.
  if (!isAgency(row.agency)) throw new RangeError(`Unknown agency on a condition: ${row.agency}`);
  return { agency: row.agency, isCleared: row.is_cleared, agencyGuessed: row.agency_guessed };
}

/**
 * @param states every checkpoint_states row of the job (46); keys missing here fall back to the workflow defaults
 * @param conditions the job's CURRENT conditions (superseded ones excluded by the caller)
 */
export function toRuleInput(
  job: JobRowForRules,
  states: readonly StateRowForRules[],
  conditions: readonly ConditionRowForRules[],
  viewerCanViewFeeProposal: boolean,
): JobRuleInput {
  const byKey: Record<string, CheckpointStateInput> = {};
  for (const s of states) {
    if (!isCheckpointKey(s.checkpoint_key)) continue;
    byKey[s.checkpoint_key] = {
      status: s.status,
      responsibility: s.responsibility,
      decision: isRestrictedFor(s.checkpoint_key, viewerCanViewFeeProposal) ? null : s.decision,
    };
  }
  return {
    states: byKey,
    conditions: conditions.map(toConditionInput),
    approvalExpiry: job.approval_expiry,
    outcomeDate: job.outcome_date,
  };
}
