/**
 * Pure workflow rules (no I/O, no Date.now — callers pass `now`). Ported from the prototype functions
 * agencyExcluded, itemState, renderInner (totals), stage bars, jobSummary (next actions + alerts) and jobDone.
 * See docs/spec/PRODUCT_SPEC.md §6 "Computed rules".
 */
import {
  CHECKPOINTS,
  CONDITIONAL_APPROVAL_CHECKPOINT_KEY,
  JOB_COMPLETE_CHECKPOINT_KEY,
  STAGES,
  getCheckpoint,
} from "./definition.js";
import { daysUntilEndOfDay, formatDateLong } from "./dates.js";
import type {
  Agency,
  CheckpointDefinition,
  CheckpointStatus,
  OptionalAgency,
  Responsibility,
  StageDefinition,
  StageKey,
} from "./types.js";
import { OPTIONAL_AGENCIES } from "./types.js";

/** Stored state of one checkpoint, as far as the rules need it. */
export interface CheckpointStateInput {
  readonly status: CheckpointStatus;
  readonly responsibility: Responsibility | null;
  readonly decision?: "accepted" | "declined" | null;
}

/** A WAPC condition, as far as the rules need it. */
export interface ConditionInput {
  readonly agency: Agency;
  readonly isCleared: boolean;
  readonly agencyGuessed: boolean;
}

export interface JobRuleInput {
  /** Stored states keyed by checkpoint key. Missing keys fall back to defaults (not completed, default responsibility). */
  readonly states: Readonly<Record<string, CheckpointStateInput | undefined>>;
  /** Current (non-superseded) WAPC conditions. Empty when none have been extracted. */
  readonly conditions: readonly ConditionInput[];
  /** WAPC approval expiry (ISO date, yyyy-mm-dd) or null. */
  readonly approvalExpiry: string | null;
  /** WAPC outcome date (ISO date) or null. */
  readonly outcomeDate: string | null;
}

function isOptionalAgency(name: string): name is OptionalAgency {
  return (OPTIONAL_AGENCIES as readonly string[]).includes(name);
}

/**
 * An optional agency stage is excluded ("Not required – no conditions in the Decision Letter") when conditions
 * have been extracted and none of them names that agency.
 */
export function isAgencyExcluded(stage: StageDefinition, conditions: readonly ConditionInput[]): boolean {
  if (!stage.optional || !stage.agency || !isOptionalAgency(stage.agency)) return false;
  return conditions.length > 0 && !conditions.some((c) => c.agency === stage.agency);
}

export interface EffectiveCheckpointState {
  readonly key: string;
  /** Status after applying agency exclusion (excluded stages force "not_required"). */
  readonly status: CheckpointStatus;
  readonly storedStatus: CheckpointStatus;
  readonly responsibility: Responsibility | null;
  readonly excludedByConditions: boolean;
}

const stageOfCheckpoint = new Map<string, StageDefinition>(
  STAGES.flatMap((s) => s.checkpoints.map((c) => [c.key, s] as const)),
);

export function effectiveState(
  key: string,
  input: Pick<JobRuleInput, "states" | "conditions">,
): EffectiveCheckpointState {
  const def = getCheckpoint(key);
  const stage = stageOfCheckpoint.get(key);
  const stored = input.states[key];
  const storedStatus = stored?.status ?? "not_completed";
  const excluded = stage ? isAgencyExcluded(stage, input.conditions) : false;
  return {
    key,
    status: excluded ? "not_required" : storedStatus,
    storedStatus,
    responsibility: stored ? stored.responsibility : def.defaultResponsibility,
    excludedByConditions: excluded,
  };
}

export interface ProgressSummary {
  readonly completed: number;
  readonly notCompleted: number;
  readonly notRequired: number;
  readonly total: number;
  /** round((completed + notRequired) / total * 100) */
  readonly percent: number;
}

function tally(keys: readonly string[], input: Pick<JobRuleInput, "states" | "conditions">): ProgressSummary {
  let completed = 0;
  let notRequired = 0;
  let notCompleted = 0;
  for (const k of keys) {
    const s = effectiveState(k, input).status;
    if (s === "completed") completed++;
    else if (s === "not_required") notRequired++;
    else notCompleted++;
  }
  const total = keys.length;
  const percent = total === 0 ? 0 : Math.round(((completed + notRequired) / total) * 100);
  return { completed, notCompleted, notRequired, total, percent };
}

/** Whole-job progress over all 46 checkpoints (progress ring, bar and counts). */
export function summariseProgress(input: Pick<JobRuleInput, "states" | "conditions">): ProgressSummary {
  return tally(
    CHECKPOINTS.map((c) => c.key),
    input,
  );
}

export interface StageSummary extends ProgressSummary {
  readonly stage: StageKey;
  /** Colour of the stage bar: "not_completed" if anything is open, else "completed" if anything completed, else "not_required". */
  readonly state: CheckpointStatus;
  /** Stage auto-excluded because the Decision Letter has no conditions for its agency. */
  readonly excluded: boolean;
  /** Text shown on the bar: "3 to do" / "Complete" / "Not required". */
  readonly label: string;
}

export function summariseStage(
  stage: StageDefinition,
  input: Pick<JobRuleInput, "states" | "conditions">,
): StageSummary {
  const p = tally(
    stage.checkpoints.map((c) => c.key),
    input,
  );
  const state: CheckpointStatus = p.notCompleted > 0 ? "not_completed" : p.completed > 0 ? "completed" : "not_required";
  const excluded = isAgencyExcluded(stage, input.conditions);
  const label = excluded
    ? "Not required – no conditions in the Decision Letter"
    : p.notCompleted > 0
      ? `${p.notCompleted} to do`
      : state === "completed"
        ? "Complete"
        : "Not required";
  return { ...p, stage: stage.key, state, excluded, label };
}

/** A job is complete only once 12.3 "Plan in order for dealings" is Completed. */
export function isJobComplete(input: Pick<JobRuleInput, "states" | "conditions">): boolean {
  return effectiveState(JOB_COMPLETE_CHECKPOINT_KEY, input).status === "completed";
}

export interface NextAction {
  readonly checkpointKey: string;
  readonly number: string;
  readonly title: string;
  readonly stage: StageKey;
  readonly stageName: string;
  readonly responsibility: Responsibility | null;
}

function firstOpen(
  stage: StageDefinition,
  input: Pick<JobRuleInput, "states" | "conditions">,
): CheckpointDefinition | undefined {
  return stage.checkpoints.find((c) => effectiveState(c.key, input).status === "not_completed");
}

function toNextAction(
  stage: StageDefinition,
  c: CheckpointDefinition,
  input: Pick<JobRuleInput, "states" | "conditions">,
): NextAction {
  return {
    checkpointKey: c.key,
    number: c.number,
    title: c.title,
    stage: stage.key,
    stageName: stage.name,
    responsibility: effectiveState(c.key, input).responsibility,
  };
}

/**
 * "Next to action", reported in phases:
 *  1. Preliminaries then WAPC Approval — one next item at a time, in order;
 *  2. the agency stages run side by side — the first open item in each non-excluded agency stage;
 *  3. WAPC, Survey, Landgate, Titles — one next item at a time, in order.
 */
export function nextActions(input: Pick<JobRuleInput, "states" | "conditions">): NextAction[] {
  const before = STAGES.filter((s) => s.phase === "sequential-before");
  const agencies = STAGES.filter((s) => s.phase === "agencies");
  const after = STAGES.filter((s) => s.phase === "sequential-after");

  for (const s of before) {
    const c = firstOpen(s, input);
    if (c) return [toNextAction(s, c, input)];
  }
  const parallel: NextAction[] = [];
  for (const s of agencies) {
    if (isAgencyExcluded(s, input.conditions)) continue;
    const c = firstOpen(s, input);
    if (c) parallel.push(toNextAction(s, c, input));
  }
  if (parallel.length > 0) return parallel;
  for (const s of after) {
    const c = firstOpen(s, input);
    if (c) return [toNextAction(s, c, input)];
  }
  return [];
}

export type AlertLevel = "bad" | "warn";
export type AlertCode =
  | "approval_expired"
  | "approval_expiring"
  | "outcome_passed"
  | "outcome_due"
  | "client_declined"
  | "conditions_agency_unchecked";

export interface JobAlert {
  readonly code: AlertCode;
  readonly level: AlertLevel;
  readonly text: string;
  readonly checkpointKey?: string;
}

/** Approval expiry warning window (days). */
export const APPROVAL_EXPIRY_WARN_DAYS = 180;
/** Outcome-date warning window (days). */
export const OUTCOME_WARN_DAYS = 14;

/** Dashboard alerts ("things worth flagging"), in the prototype's order. */
export function jobAlerts(input: JobRuleInput, now: Date): JobAlert[] {
  const alerts: JobAlert[] = [];
  if (input.approvalExpiry) {
    const days = daysUntilEndOfDay(input.approvalExpiry, now);
    if (days < 0) {
      alerts.push({
        code: "approval_expired",
        level: "bad",
        text: `WAPC approval expired ${formatDateLong(input.approvalExpiry)}`,
      });
    } else if (days < APPROVAL_EXPIRY_WARN_DAYS) {
      alerts.push({
        code: "approval_expiring",
        level: "warn",
        text: `WAPC approval expires in ${days} days (${formatDateLong(input.approvalExpiry)})`,
      });
    }
  }
  if (input.outcomeDate && effectiveState(CONDITIONAL_APPROVAL_CHECKPOINT_KEY, input).status === "not_completed") {
    const days = daysUntilEndOfDay(input.outcomeDate, now);
    if (days < 0) {
      alerts.push({
        code: "outcome_passed",
        level: "bad",
        text: `WAPC outcome date passed ${formatDateLong(input.outcomeDate)} – no approval recorded`,
      });
    } else if (days <= OUTCOME_WARN_DAYS) {
      alerts.push({ code: "outcome_due", level: "warn", text: `WAPC outcome due in ${days} days` });
    }
  }
  for (const c of CHECKPOINTS) {
    const approval = c.panels.find((p) => p.type === "approval");
    if (!approval) continue;
    const stored = input.states[c.key];
    if (stored?.decision === "declined" && effectiveState(c.key, input).status === "not_completed") {
      alerts.push({
        code: "client_declined",
        level: "bad",
        text: `Client declined the ${approval.noun} (${c.number})`,
        checkpointKey: c.key,
      });
    }
  }
  const guessed = input.conditions.filter((c) => c.agencyGuessed).length;
  if (guessed > 0) {
    alerts.push({
      code: "conditions_agency_unchecked",
      level: "warn",
      text: `${guessed} condition${guessed > 1 ? "s" : ""} need their agency checked`,
    });
  }
  return alerts;
}

export interface JobSummary {
  readonly progress: ProgressSummary;
  readonly isComplete: boolean;
  readonly nextActions: readonly NextAction[];
  readonly alerts: readonly JobAlert[];
  /** True when any next action is the client's responsibility ("Waiting on client" dashboard count). */
  readonly isWaitingOnClient: boolean;
}

/** Everything the dashboard card needs for one job. */
export function summariseJob(input: JobRuleInput, now: Date): JobSummary {
  const isComplete = isJobComplete(input);
  const next = nextActions(input);
  return {
    progress: summariseProgress(input),
    isComplete,
    nextActions: next,
    alerts: jobAlerts(input, now),
    isWaitingOnClient: !isComplete && next.some((n) => n.responsibility === "client"),
  };
}
