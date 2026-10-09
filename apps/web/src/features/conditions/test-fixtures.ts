/** Synthetic conditions for conditions tests (TD-1: nothing here comes from the prototype's real job). */
import { Condition, type JobDetail } from "@kr/contracts";
import type { Agency } from "@kr/workflow";
import { syntheticJob, type SyntheticJobOptions } from "@/features/tracker/test-fixtures";

export interface SyntheticConditionJobOptions extends Omit<SyntheticJobOptions, "conditionAgencies"> {
  /** One condition per entry, numbered from 1. */
  readonly agencies?: readonly Agency[];
  /** Fields to set on the condition at the same index. */
  readonly conditions?: readonly Partial<Condition>[];
}

/** A job whose conditions are the given ones (the stage exclusion of the other agencies follows from them, R1). */
export function syntheticConditionJob({
  agencies = [],
  conditions = [],
  ...options
}: SyntheticConditionJobOptions = {}): JobDetail {
  const base = syntheticJob({ ...options, conditionAgencies: agencies });
  const list = base.conditions.map((condition, index) => Condition.parse({ ...condition, ...conditions[index] }));
  return { ...base, conditions: list };
}

/** `job` with the condition `id` changed by `patch`: what the "server" holds after a write. */
export function withCondition(job: JobDetail, id: string, patch: Partial<Condition>): JobDetail {
  return { ...job, conditions: job.conditions.map((c) => (c.id === id ? { ...c, ...patch } : c)) };
}

/** The condition at `index` of `job` (the tests seed them, so it is there). */
export function conditionAt(job: JobDetail, index: number): Condition {
  const found = job.conditions[index];
  if (!found) throw new Error(`No condition at ${index}`);
  return found;
}
