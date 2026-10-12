/**
 * Reads for the dashboard (BE-7: Kysely only). A list or facets request reads every job the caller can see plus a
 * fingerprint of each job's states and conditions (two grouped aggregates, ~2,000 small rows), and only then the ~46 state
 * rows of the jobs whose fingerprint changed since their summary was last computed (domain/job-summaries.ts).
 */
import type { GrantRole } from "@kr/contracts";
import type { Database, Db } from "@kr/db";
import { sql, type ExpressionBuilder } from "kysely";
import type { AuthContext } from "../../../platform/auth-context.js";
import { visibleJobs } from "../../_shared/index.js";
import type { ConditionRowForRules, StateRowForRules } from "../domain/rule-input.js";
import type { RuleRows, StampedJob } from "../domain/job-summaries.js";
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

/** Rows per `job_id IN (...)`: far below Postgres' 65,535 bound parameters. */
const ID_CHUNK = 5000;

function groupBy<T extends { job_id: string }>(rows: readonly T[]): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const row of rows) {
    const list = out.get(row.job_id);
    if (list) list.push(row);
    else out.set(row.job_id, [row]);
  }
  return out;
}

interface Slot<T> {
  running: Promise<T> | null;
  queued: Promise<T> | null;
}

/**
 * Runs `read` per key, but never lets two reads of one key overlap and never hands a caller the result of a read that
 * started before the call (read-your-writes: a write committed before the call is in the result). Callers arriving while a
 * read runs share the single read that starts right after it, so N concurrent requests cost at most two reads in a row.
 * Callers of one key must pass equivalent `read`s (the key names everything the read depends on). A key is forgotten
 * once its reads are done, so nothing accumulates.
 */
export class FreshReads<T> {
  private readonly slots = new Map<string, Slot<T>>();

  fresh(key: string, read: () => Promise<T>): Promise<T> {
    const slot = this.slots.get(key) ?? { running: null, queued: null };
    this.slots.set(key, slot);
    if (!slot.running && !slot.queued) return this.start(key, slot, read);
    const running = slot.running;
    slot.queued ??= (running ? running.then(noop, noop) : Promise.resolve()).then(() => {
      slot.queued = null;
      return this.start(key, slot, read);
    });
    return slot.queued;
  }

  /** Keys with a read running or waiting (0 when idle). */
  get size(): number {
    return this.slots.size;
  }

  private start(key: string, slot: Slot<T>, read: () => Promise<T>): Promise<T> {
    const run = read();
    slot.running = run;
    const done = () => {
      if (slot.running !== run) return;
      slot.running = null;
      if (!slot.queued) this.slots.delete(key);
    };
    run.then(done, done);
    return run;
  }
}

function noop(): void {
  // a failed read is reported to the callers who started it, not to those queued behind it
}

/** The fingerprint of every job's checkpoint states and conditions (see `createStampReader`). */
export type JobStamps = ReadonlyMap<string, string>;

export interface StampReader {
  /** Stamps of all jobs as of a moment after this call. */
  fresh(): Promise<JobStamps>;
}

/**
 * Fingerprints of the rows each summary is computed from, for ALL jobs at once (so one read serves every caller whatever
 * they may see; visibility is applied by the jobs query, ids never leave this module unfiltered). A job's stamp is
 * `sum(version):count` over its checkpoint states, and the same plus the count of current rows over its conditions: every write
 * bumps a `version` or adds a row, and superseding adds rows without touching old versions.
 */
export function createStampReader(db: Db): StampReader {
  const reads = new FreshReads<JobStamps>();
  const read = async () => {
    const [states, conditions] = await Promise.all([
      db
        .selectFrom("checkpoint_states")
        .select(["job_id", sql<string>`concat(sum(version), ':', count(*))`.as("stamp")])
        .groupBy("job_id")
        .execute(),
      db
        .selectFrom("conditions")
        .select([
          "job_id",
          sql<string>`concat(sum(version), ':', count(*), ':', count(*) filter (where superseded_at is null))`.as(
            "stamp",
          ),
        ])
        .groupBy("job_id")
        .execute(),
    ]);
    const stamps = new Map<string, string>();
    for (const s of states) stamps.set(s.job_id, `${s.stamp}/`);
    for (const c of conditions) stamps.set(c.job_id, `${stamps.get(c.job_id) ?? "/"}${c.stamp}`);
    return stamps;
  };
  return { fresh: () => reads.fresh("", read) };
}

export interface StampedJobs {
  readonly jobs: StampedJob[];
  /** The viewer's ACTIVE grant role per job (externals only). */
  readonly grantRoles: Map<string, GrantRole>;
}

/** Jobs the caller may see (archived excluded) matching `filters`, each with its stamp. */
export async function loadStampedJobs(
  db: Db,
  stamps: StampReader,
  auth: AuthContext,
  filters: JobFilters = {},
): Promise<StampedJobs> {
  const [rows, stamp] = await Promise.all([
    db
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
      .where(wanted(auth, filters))
      .execute(),
    stamps.fresh(),
  ]);
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
    jobs: rows.map((row) => ({ row, stamp: stamp.get(row.id) ?? "/" })),
    grantRoles: new Map<string, GrantRole>(grants.map((g) => [g.job_id, g.role])),
  };
}

/**
 * The checkpoint states and current (non-superseded) conditions of the given jobs. Callers pass ids from `loadStampedJobs`,
 * so visibility has already been applied.
 */
export async function loadRuleRows(db: Db, jobIds: readonly string[]): Promise<RuleRows> {
  const states: (StateRowForRules & { job_id: string })[] = [];
  const conditions: (ConditionRowForRules & { job_id: string })[] = [];
  for (let i = 0; i < jobIds.length; i += ID_CHUNK) {
    const ids = jobIds.slice(i, i + ID_CHUNK);
    states.push(
      ...(await db
        .selectFrom("checkpoint_states")
        .select(["job_id", "checkpoint_key", "status", "responsibility", "decision"])
        .where("job_id", "in", ids)
        .execute()),
    );
    conditions.push(
      ...(await db
        .selectFrom("conditions")
        .select(["job_id", "agency", "agency_guessed", "is_cleared"])
        .where("job_id", "in", ids)
        .where("superseded_at", "is", null)
        .execute()),
    );
  }
  return { states: groupBy(states), conditions: groupBy(conditions) };
}
