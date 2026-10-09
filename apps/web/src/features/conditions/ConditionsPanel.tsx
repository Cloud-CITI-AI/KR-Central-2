import type { CheckpointState, JobDetail } from "@kr/contracts";

export interface ConditionsPanelProps {
  readonly job: JobDetail;
  /** The 5.0 checkpoint (files in slot "decision"). */
  readonly checkpoint: CheckpointState;
}

/** 5.0 body: decision-letter folder, extract button(s), conditions checklist (§5.5/§5.6) — STUB owned by WP-16. */
export function ConditionsPanel({ job }: ConditionsPanelProps) {
  return <div data-conditions-count={job.conditions.length} />;
}
