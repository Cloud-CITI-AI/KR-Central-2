/** Synthetic conditions for conditions tests (TD-1: nothing here comes from the prototype's real job). */
import { Condition, Operation, type JobDetail } from "@kr/contracts";
import type { Agency } from "@kr/workflow";
import { syntheticJob, type SyntheticJobOptions } from "@/features/tracker/test-fixtures";

export const OPERATION_ID = "6f1d3b0e-5c1a-4b64-9d4e-0d8b1a2c3d4e";
const AT = "2026-09-28T03:50:56.543Z";

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

/** A `conditions.extract` operation in `status`, with `result` once it succeeded. */
export function extractionOperation(
  jobId: string,
  status: "queued" | "running" | "succeeded" | "failed",
  result: unknown = null,
  error: { code: string; message: string } = { code: "unreadable", message: "Could not read the PDF" },
) {
  return Operation.parse({
    id: OPERATION_ID,
    jobId,
    type: "conditions.extract",
    status,
    createdAt: AT,
    completedAt: status === "succeeded" || status === "failed" ? AT : null,
    result,
    error: status === "failed" ? error : null,
  });
}

/** The result of an extraction that found `conditionsCount` conditions. */
export function extractionResult(conditionsCount: number, message: string | null = null) {
  return { conditionsCount, guessedNumbers: [], approvalDate: null, approvalExpiry: null, message };
}

/** What the API answers for `body` applied to `condition`: the fields it sets, the guess ended by an agency choice, version + 1. */
export function conditionAfter(condition: Condition, body: Record<string, unknown>): Condition {
  const { agencyConfirmed, ...fields } = body;
  return Condition.parse({
    ...condition,
    ...fields,
    agencyGuessed: agencyConfirmed === true || "agency" in fields ? false : condition.agencyGuessed,
    version: condition.version + 1,
  });
}
