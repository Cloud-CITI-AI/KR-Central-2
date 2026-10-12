/**
 * Summaries for a set of jobs: the single place where loaded rows meet the workflow rules for list and facet endpoints.
 * Pure; `now` comes from the injected clock.
 */
import { jobCapabilitiesFor, type GlobalRole, type GrantRole } from "@kr/contracts";
import { endOfBusinessDay, summariseJob, type JobSummary } from "@kr/workflow";
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

function toEntry(row: SummaryJobRow, summary: JobSummary): SummarisedJob {
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
}

function summariseRow(
  row: SummaryJobRow,
  states: readonly StateRowForRules[],
  conditions: readonly ConditionRowForRules[],
  viewerCanSeeFeeProposal: boolean,
  now: Date,
): JobSummary {
  return summariseJob(toRuleInput(row, states, conditions, viewerCanSeeFeeProposal), now);
}

function feeProposalVisible(loaded: Pick<LoadedJobs, "grantRoles">, viewerRole: GlobalRole, jobId: string): boolean {
  return canViewFeeProposal(jobCapabilitiesFor(viewerRole, loaded.grantRoles.get(jobId) ?? null));
}

export function summariseLoaded(loaded: LoadedJobs, viewerRole: GlobalRole, now: Date): SummarisedJob[] {
  return loaded.jobs.map((row) =>
    toEntry(
      row,
      summariseRow(
        row,
        loaded.states.get(row.id) ?? [],
        loaded.conditions.get(row.id) ?? [],
        feeProposalVisible(loaded, viewerRole, row.id),
        now,
      ),
    ),
  );
}

// ---------------------------------------------------------------------------------------------------- summary cache

const MS_PER_DAY = 86_400_000;
/** Every business date ends at this instant of the UTC day (23:59:59 Perth), so day counts step here and nowhere else. */
const DAY_STEP_ORIGIN = endOfBusinessDay("1970-01-01").getTime();

/**
 * The part of `now` a summary depends on. The only time-dependent rule is the alerts' whole-day counts
 * (`daysUntilEndOfDay`, a ceiling against 23:59:59 Perth), which are constant between two such instants and take their
 * own value at exactly the instant; so two instants with the same key give identical summaries (pinned by a test that
 * sweeps the boundaries).
 */
export function summaryDayKey(now: Date): string {
  const sinceOrigin = now.getTime() - DAY_STEP_ORIGIN;
  const day = Math.floor(sinceOrigin / MS_PER_DAY);
  return sinceOrigin === day * MS_PER_DAY ? `${day.toString()}=` : day.toString();
}

/** One job as loaded for a list: the row plus a fingerprint of everything else its summary is computed from. */
export interface StampedJob {
  readonly row: SummaryJobRow;
  /**
   * Changes whenever a checkpoint state or a condition of the job is written or added (the data layer builds it from the
   * rows' version counters and counts). Equal stamps mean equal states and conditions.
   */
  readonly stamp: string;
}

/** The checkpoint states and current conditions of some jobs, grouped by job id. */
export interface RuleRows {
  readonly states: ReadonlyMap<string, readonly StateRowForRules[]>;
  readonly conditions: ReadonlyMap<string, readonly ConditionRowForRules[]>;
}

/**
 * Per-process memo of job summaries. An entry is only used when its key (stamp, the job's WAPC dates, the day, whether the
 * viewer sees the fee proposal) is the one being asked for, so a changed job simply misses; nothing is ever invalidated
 * by hand and a restart or a second API instance only costs a recompute. Bounded: it empties itself when it outgrows
 * `maxEntries` (the designed scale is 2,000 jobs, two viewer kinds).
 */
export class SummaryCache {
  private readonly entries = new Map<string, { readonly key: string; readonly summary: JobSummary }>();
  constructor(private readonly maxEntries = 20_000) {}

  get(jobId: string, viewerCanSeeFeeProposal: boolean, key: string): JobSummary | undefined {
    const hit = this.entries.get(`${jobId}:${viewerCanSeeFeeProposal ? "fee" : "nofee"}`);
    return hit?.key === key ? hit.summary : undefined;
  }

  set(jobId: string, viewerCanSeeFeeProposal: boolean, key: string, summary: JobSummary): void {
    if (this.entries.size >= this.maxEntries) this.entries.clear();
    this.entries.set(`${jobId}:${viewerCanSeeFeeProposal ? "fee" : "nofee"}`, { key, summary });
  }

  get size(): number {
    return this.entries.size;
  }
}

/**
 * The same result as `summariseLoaded` over every job's rows, but a job whose stamp, dates and day are unchanged since the
 * last request reuses its summary and only the others have their states and conditions fetched (`loadRows`) and summarised.
 * Order follows `jobs`.
 */
export async function summariseWithCache(
  jobs: readonly StampedJob[],
  grantRoles: ReadonlyMap<string, GrantRole>,
  viewerRole: GlobalRole,
  now: Date,
  cache: SummaryCache,
  loadRows: (jobIds: readonly string[]) => Promise<RuleRows>,
): Promise<SummarisedJob[]> {
  const day = summaryDayKey(now);
  const plan = jobs.map(({ row, stamp }) => {
    const fee = feeProposalVisible({ grantRoles }, viewerRole, row.id);
    const key = `${stamp}|${row.approval_expiry ?? ""}|${row.outcome_date ?? ""}|${day}`;
    return { row, fee, key, hit: cache.get(row.id, fee, key) };
  });
  const missing = plan.filter((p) => !p.hit).map((p) => p.row.id);
  const rows: RuleRows = missing.length > 0 ? await loadRows(missing) : { states: new Map(), conditions: new Map() };
  return plan.map(({ row, fee, key, hit }) => {
    if (hit) return toEntry(row, hit);
    const summary = summariseRow(row, rows.states.get(row.id) ?? [], rows.conditions.get(row.id) ?? [], fee, now);
    cache.set(row.id, fee, key, summary);
    return toEntry(row, summary);
  });
}
