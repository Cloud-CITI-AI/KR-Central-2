/** Reads for the dashboard: every job the caller can see, with the rows the workflow rules need (BE-7: Kysely only). */
import type { GrantRole } from "@kr/contracts";
import type { Database, Db } from "@kr/db";
import type { ExpressionBuilder } from "kysely";
import type { AuthContext } from "../../../platform/auth-context.js";
import { visibleJobs } from "../../_shared/index.js";
import type { ConditionRowForRules, StateRowForRules } from "../domain/rule-input.js";
import type { LoadedJobs } from "../domain/job-summaries.js";
import { searchPattern } from "../domain/job-list.js";

export interface JobFilters {
  /** Subdivision type name (exact). */
  readonly type?: string | undefined;
  /** Search text; matches job number, address or client name, case-insensitively. */
  readonly q?: string | undefined;
}

function wanted(auth: AuthContext, filters: JobFilters) {
  const visible = visibleJobs(auth);
  const q = filters.q?.trim();
  return (eb: ExpressionBuilder<Database, "jobs">) => {
    const parts = [visible(eb)];
    if (filters.type) parts.push(eb("jobs.subdivision_type", "=", filters.type));
    if (q) {
      const pattern = searchPattern(q);
      parts.push(
        eb.or([
          eb("jobs.job_number", "ilike", pattern),
          eb("jobs.address", "ilike", pattern),
          eb("jobs.client_name", "ilike", pattern),
        ]),
      );
    }
    return eb.and(parts);
  };
}

function groupBy<T extends { job_id: string }>(rows: readonly T[]): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const row of rows) {
    const list = out.get(row.job_id);
    if (list) list.push(row);
    else out.set(row.job_id, [row]);
  }
  return out;
}

/** Jobs the caller may see (archived excluded) matching `filters`, with their states, current conditions and grant roles. */
export async function loadJobsForSummary(db: Db, auth: AuthContext, filters: JobFilters = {}): Promise<LoadedJobs> {
  const pred = wanted(auth, filters);
  const jobs = await db
    .selectFrom("jobs")
    .select([
      "id",
      "job_number",
      "address",
      "client_name",
      "subdivision_type",
      "updated_at",
      "approval_expiry",
      "outcome_date",
    ])
    .where(pred)
    .execute();
  const states = await db
    .selectFrom("checkpoint_states")
    .innerJoin("jobs", "jobs.id", "checkpoint_states.job_id")
    .select([
      "checkpoint_states.job_id",
      "checkpoint_states.checkpoint_key",
      "checkpoint_states.status",
      "checkpoint_states.responsibility",
      "checkpoint_states.decision",
    ])
    .where(pred)
    .execute();
  const conditions = await db
    .selectFrom("conditions")
    .innerJoin("jobs", "jobs.id", "conditions.job_id")
    .select(["conditions.job_id", "conditions.agency", "conditions.agency_guessed", "conditions.is_cleared"])
    .where("conditions.superseded_at", "is", null)
    .where(pred)
    .execute();
  const grants =
    auth.user.role === "external"
      ? await db
          .selectFrom("access_grants")
          .select(["job_id", "role"])
          .where("user_id", "=", auth.user.id)
          .where("status", "=", "active")
          .execute()
      : [];
  return {
    jobs,
    states: groupBy<StateRowForRules & { job_id: string }>(states),
    conditions: groupBy<ConditionRowForRules & { job_id: string }>(conditions),
    grantRoles: new Map<string, GrantRole>(grants.map((g) => [g.job_id, g.role])),
  };
}
