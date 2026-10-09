import { JobCard } from "@kr/contracts";
import { summariseJob } from "@kr/workflow";
import { describe, expect, it } from "vitest";
import { toJobCard, toSubdivisionType } from "./job-card.js";
import { toRuleInput } from "./rule-input.js";
import { summariseLoaded, type LoadedJobs, type SummaryJobRow } from "./job-summaries.js";

const row: SummaryJobRow = {
  id: "0f8fad5b-d9cb-469f-a165-70867728950e",
  job_number: "S-0001",
  address: "1 Example Street, Testville",
  client_name: "Sample Developments Pty Ltd",
  subdivision_type: "Survey-Strata",
  updated_at: new Date("2026-03-01T04:00:00Z"),
  approval_expiry: null,
  outcome_date: null,
};
const NOW = new Date("2026-03-02T01:00:00Z");

describe("toJobCard", () => {
  it("maps a row and its workflow summary to the contract's JobCard", () => {
    const card = toJobCard(row, summariseJob(toRuleInput(row, [], [], true), NOW));
    expect(JobCard.parse(card)).toEqual(card);
    expect(card).toMatchObject({
      jobNumber: "S-0001",
      clientName: "Sample Developments Pty Ltd",
      updatedAt: "2026-03-01T04:00:00.000Z",
      isComplete: false,
      progress: { total: 46, completed: 0 },
    });
  });

  it("keeps a missing client and type as null and rejects a type outside the workflow list", () => {
    const card = toJobCard(
      { ...row, client_name: null, subdivision_type: null },
      summariseJob(toRuleInput(row, [], [], true), NOW),
    );
    expect(card).toMatchObject({ clientName: null, subdivisionType: null });
    expect(toSubdivisionType("Freehold")).toBe("Freehold");
    expect(() => toSubdivisionType("Bogus")).toThrow(RangeError);
  });
});

describe("summariseLoaded", () => {
  const loaded = (overrides: Partial<LoadedJobs> = {}): LoadedJobs => ({
    jobs: [row],
    states: new Map([
      [row.id, [{ checkpoint_key: "i1_0p", status: "not_completed", responsibility: "client", decision: "declined" }]],
    ]),
    conditions: new Map(),
    grantRoles: new Map(),
    ...overrides,
  });

  it("uses the viewer's role on each job to decide whether the fee proposal decision counts", () => {
    expect(summariseLoaded(loaded(), "kr_admin", NOW)[0]?.alertCount).toBe(1);
    expect(summariseLoaded(loaded(), "staff", NOW)[0]?.alertCount).toBe(0);
    const external = (grant: "client" | "architect") =>
      summariseLoaded(loaded({ grantRoles: new Map([[row.id, grant]]) }), "external", NOW)[0]?.alertCount;
    expect(external("client")).toBe(1);
    expect(external("architect")).toBe(0);
  });

  it("fills the list entry from the summary", () => {
    const [e] = summariseLoaded(loaded({ states: new Map() }), "admin", NOW);
    expect(e).toMatchObject({
      id: row.id,
      jobNumber: "S-0001",
      subdivisionType: "Survey-Strata",
      isComplete: false,
      isWaitingOnClient: true,
      alertCount: 0,
    });
  });
});
