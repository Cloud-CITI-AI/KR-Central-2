/**
 * Summaries for a set of jobs: the single place where loaded rows meet the workflow rules for list and facet endpoints.
 * Pure; `now` comes from the injected clock.
 */
import { jobCapabilitiesFor, type GlobalRole, type GrantRole } from "@kr/contracts";
import { summariseJob, type JobSummary } from "@kr/workflow";
import type { CardJobRow } from "./job-card.js";
import type { ListEntry } from "./job-list.js";
import {
  canViewFeeProposal,
  toRuleInput,
  type ConditionRowForRules,
  type JobRowForRules,
  type StateRowForRules,
} from "./rule-input.js";

export type SummaryJobRow = CardJobRow & JobRowForRules;

/** Rows of many jobs, grouped by job id. */
export interface LoadedJobs {
  readonly jobs: readonly SummaryJobRow[];
  readonly states: ReadonlyMap<string, readonly StateRowForRules[]>;
  readonly conditions: ReadonlyMap<string, readonly ConditionRowForRules[]>;
  /** The viewer's ACTIVE grant role per job (externals only). */
  readonly grantRoles: ReadonlyMap<string, GrantRole>;
}

export interface SummarisedJob extends ListEntry {
  readonly row: SummaryJobRow;
  readonly summary: JobSummary;
}

export function summariseLoaded(loaded: LoadedJobs, viewerRole: GlobalRole, now: Date): SummarisedJob[] {
  return loaded.jobs.map((row) => {
    const caps = jobCapabilitiesFor(viewerRole, loaded.grantRoles.get(row.id) ?? null);
    const input = toRuleInput(
      row,
      loaded.states.get(row.id) ?? [],
      loaded.conditions.get(row.id) ?? [],
      canViewFeeProposal(caps),
    );
    const summary = summariseJob(input, now);
    return {
      id: row.id,
      jobNumber: row.job_number,
      subdivisionType: row.subdivision_type,
      isComplete: summary.isComplete,
      isWaitingOnClient: summary.isWaitingOnClient,
      alertCount: summary.alerts.length,
      row,
      summary,
    };
  });
}
