import { endOfBusinessDay, summariseJob } from "@kr/workflow";
import { describe, expect, it, vi } from "vitest";
import type { GlobalRole, GrantRole } from "@kr/contracts";
import { toRuleInput, type ConditionRowForRules, type StateRowForRules } from "./rule-input.js";
import {
  SummaryCache,
  summariseLoaded,
  summariseWithCache,
  summaryDayKey,
  type LoadedJobs,
  type RuleRows,
  type StampedJob,
  type SummaryJobRow,
} from "./job-summaries.js";

const NOW = new Date("2026-03-02T01:00:00Z");
const DAY = 86_400_000;

const jobRow = (
  n: number,
  dates: Partial<Pick<SummaryJobRow, "approval_expiry" | "outcome_date">> = {},
): SummaryJobRow => ({
  id: `00000000-0000-4000-8000-${n.toString().padStart(12, "0")}`,
  job_number: `S-${n.toString().padStart(4, "0")}`,
  address: `${n.toString()} Example Street, Testville`,
  client_name: null,
  subdivision_type: "Freehold",
  updated_at: new Date("2026-03-01T04:00:00Z"),
  approval_expiry: null,
  outcome_date: null,
  ...dates,
});
const state = (
  key: string,
  status: StateRowForRules["status"],
  responsibility: StateRowForRules["responsibility"] = "kr",
  decision: StateRowForRules["decision"] = null,
): StateRowForRules => ({ checkpoint_key: key, status, responsibility, decision });
const cond = (
  agency: ConditionRowForRules["agency"],
  agencyGuessed = false,
  isCleared = false,
): ConditionRowForRules => ({
  agency,
  agency_guessed: agencyGuessed,
  is_cleared: isCleared,
});

/** Jobs in the shapes the summaries depend on: untouched, mid-way, complete, declined fee proposal, dated, with conditions. */
function fixture() {
  const rows = [
    jobRow(1),
    jobRow(2, { approval_expiry: "2026-03-04", outcome_date: "2026-03-10" }),
    jobRow(3, { approval_expiry: "2026-02-01" }),
    jobRow(4, { outcome_date: "2026-03-02" }),
    jobRow(5),
    jobRow(6, { approval_expiry: "2027-01-01" }),
  ];
  const [r1, r2, r3, r4, r5, r6] = rows as [
    SummaryJobRow,
    SummaryJobRow,
    SummaryJobRow,
    SummaryJobRow,
    SummaryJobRow,
    SummaryJobRow,
  ];
  const states = new Map<string, StateRowForRules[]>([
    [r2.id, [state("i1_0p", "not_completed", "client", "declined"), state("i2_0", "completed")]],
    [r3.id, [state("i3_0p", "not_completed", "client", "declined")]],
    [r4.id, [state("i2_0", "completed", "client"), state("i13_2", "completed")]],
    [r5.id, [state("i13_2", "completed")]],
  ]);
  const conditions = new Map<string, ConditionRowForRules[]>([
    [r4.id, [cond("Western Power", true), cond("WAPC", false, true)]],
    [r6.id, [cond("Water Corporation"), cond("Local Government", true)]],
  ]);
  const grantRoles = new Map<string, GrantRole>([
    [r1.id, "client"],
    [r2.id, "client"],
    [r3.id, "architect"],
    [r4.id, "architect"],
    [r5.id, "client"],
    [r6.id, "architect"],
  ]);
  const loaded: LoadedJobs = { jobs: rows, states, conditions, grantRoles };
  const stamped = (stamps: Record<string, string> = {}): StampedJob[] =>
    rows.map((row, i) => ({ row, stamp: stamps[row.id] ?? `s${i.toString()}` }));
  const loadRows = vi.fn((ids: readonly string[]): Promise<RuleRows> =>
    Promise.resolve({
      states: new Map(ids.flatMap((id) => (states.has(id) ? [[id, states.get(id)!] as const] : []))),
      conditions: new Map(ids.flatMap((id) => (conditions.has(id) ? [[id, conditions.get(id)!] as const] : []))),
    }),
  );
  return { rows, loaded, stamped, loadRows, grantRoles, states, conditions };
}

const VIEWERS: GlobalRole[] = ["admin", "kr_admin", "staff", "external"];

describe("summariseWithCache", () => {
  it("gives exactly what summariseLoaded gives, cold and warm, for every kind of viewer", async () => {
    const fx = fixture();
    const cache = new SummaryCache();
    for (const viewer of VIEWERS) {
      const expected = summariseLoaded(fx.loaded, viewer, NOW);
      const run = () => summariseWithCache(fx.stamped(), fx.grantRoles, viewer, NOW, cache, fx.loadRows);
      expect(await run()).toEqual(expected);
      expect(await run()).toEqual(expected);
    }
    // The fixture really distinguishes what a viewer may see.
    const alerts = (viewer: GlobalRole) => summariseLoaded(fx.loaded, viewer, NOW).map((e) => e.alertCount);
    expect(alerts("kr_admin")).not.toEqual(alerts("staff"));
  });

  it("reads rows only for the jobs it has no summary for, and nothing at all when nothing changed", async () => {
    const fx = fixture();
    const cache = new SummaryCache();
    const run = (stamps: Record<string, string> = {}, now = NOW) =>
      summariseWithCache(fx.stamped(stamps), fx.grantRoles, "kr_admin", now, cache, fx.loadRows);
    await run();
    expect(fx.loadRows).toHaveBeenLastCalledWith(fx.rows.map((r) => r.id));
    fx.loadRows.mockClear();
    await run();
    expect(fx.loadRows).not.toHaveBeenCalled();
    const changed = fx.rows[1]!.id;
    await run({ [changed]: "changed" });
    expect(fx.loadRows).toHaveBeenCalledExactlyOnceWith([changed]);
  });

  it("recomputes a job whose WAPC dates changed even if its states and conditions did not", async () => {
    const fx = fixture();
    const cache = new SummaryCache();
    const first = await summariseWithCache(fx.stamped(), fx.grantRoles, "admin", NOW, cache, fx.loadRows);
    fx.loadRows.mockClear();
    const rows = fx.rows.map((r, i) => (i === 0 ? { ...r, approval_expiry: "2026-03-03" } : r));
    const stamped = rows.map((row, i) => ({ row, stamp: `s${i.toString()}` }));
    const second = await summariseWithCache(stamped, fx.grantRoles, "admin", NOW, cache, fx.loadRows);
    expect(fx.loadRows).toHaveBeenCalledExactlyOnceWith([rows[0]!.id]);
    expect(second[0]!.summary.alerts).not.toEqual(first[0]!.summary.alerts);
    expect(second.slice(1)).toEqual(first.slice(1));
  });

  it("recomputes everything when the day the alerts count in has moved on", async () => {
    const fx = fixture();
    const cache = new SummaryCache();
    const first = await summariseWithCache(fx.stamped(), fx.grantRoles, "admin", NOW, cache, fx.loadRows);
    fx.loadRows.mockClear();
    const tomorrow = new Date(NOW.getTime() + DAY);
    const next = await summariseWithCache(fx.stamped(), fx.grantRoles, "admin", tomorrow, cache, fx.loadRows);
    expect(fx.loadRows).toHaveBeenCalledOnce();
    expect(next).toEqual(summariseLoaded(fx.loaded, "admin", tomorrow));
    expect(next).not.toEqual(first);
  });

  it("keeps a summary computed with the fee proposal apart from one computed without it", async () => {
    const fx = fixture();
    const cache = new SummaryCache();
    const declined = fx.rows[1]!;
    const withFee = await summariseWithCache(fx.stamped(), fx.grantRoles, "kr_admin", NOW, cache, fx.loadRows);
    const without = await summariseWithCache(fx.stamped(), fx.grantRoles, "staff", NOW, cache, fx.loadRows);
    const alertCount = (list: typeof withFee) => list.find((e) => e.id === declined.id)?.alertCount;
    expect(alertCount(withFee)).toBeGreaterThan(alertCount(without) ?? 0);
    // Client vs architect grant on the same job: the same split, in either order of arrival.
    const architectGrants = new Map(fx.grantRoles).set(declined.id, "architect");
    const asArchitect = await summariseWithCache(fx.stamped(), architectGrants, "external", NOW, cache, fx.loadRows);
    const asClient = await summariseWithCache(fx.stamped(), fx.grantRoles, "external", NOW, cache, fx.loadRows);
    expect(alertCount(asArchitect)).toBe(alertCount(without));
    expect(alertCount(asClient)).toBe(alertCount(withFee));
  });

  it("empties itself rather than grow past its bound", async () => {
    const fx = fixture();
    const cache = new SummaryCache(4);
    await summariseWithCache(fx.stamped(), fx.grantRoles, "admin", NOW, cache, fx.loadRows);
    expect(cache.size).toBeLessThanOrEqual(4);
    expect(cache.size).toBeGreaterThan(0);
  });
});

describe("summaryDayKey", () => {
  it("only changes where a summary can change: swept across five days against the real rules", () => {
    const fx = fixture();
    const inputs = fx.rows.map((row) =>
      toRuleInput(row, fx.states.get(row.id) ?? [], fx.conditions.get(row.id) ?? [], true),
    );
    // Exactly at, and one millisecond either side of, the end of three consecutive business days, plus a coarse sweep.
    const instants = new Set<number>();
    for (const date of ["2026-03-01", "2026-03-02", "2026-03-03", "2026-03-04", "2026-03-10"]) {
      const end = endOfBusinessDay(date).getTime();
      for (const delta of [-DAY, -1001, -1000, -999, -1, 0, 1, 999, 1000, 1001, DAY]) instants.add(end + delta);
    }
    for (let t = Date.parse("2026-02-27T00:00:00Z"); t < Date.parse("2026-03-12T00:00:00Z"); t += 7 * 60_000 + 13_000) {
      instants.add(t);
    }
    const seen = new Map<string, string[]>();
    for (const t of [...instants].sort((a, b) => a - b)) {
      const now = new Date(t);
      const summaries = JSON.stringify(inputs.map((input) => summariseJob(input, now)));
      const key = summaryDayKey(now);
      const previous = seen.get(key);
      if (previous) expect(summaries, `${now.toISOString()} shares key ${key}`).toBe(previous[0]);
      else seen.set(key, [summaries]);
    }
    expect(seen.size).toBeGreaterThan(8);
  });

  it("is the same through a business day and different across its closing instant", () => {
    const end = endOfBusinessDay("2026-03-02").getTime();
    expect(summaryDayKey(new Date(end - 3600_000))).toBe(summaryDayKey(new Date(end - 1000)));
    expect(summaryDayKey(new Date(end - 1))).not.toBe(summaryDayKey(new Date(end)));
    expect(summaryDayKey(new Date(end))).not.toBe(summaryDayKey(new Date(end + 1)));
    expect(summaryDayKey(new Date(end + 1))).toBe(summaryDayKey(new Date(end + 3600_000)));
  });
});
