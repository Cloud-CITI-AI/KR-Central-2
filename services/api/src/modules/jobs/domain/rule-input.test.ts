import { jobCapabilitiesFor } from "@kr/contracts";
import { CHECKPOINTS, JOB_COMPLETE_CHECKPOINT_KEY, effectiveState, jobAlerts, summariseJob } from "@kr/workflow";
import { describe, expect, it } from "vitest";
import {
  canViewFeeProposal,
  isRestrictedFor,
  toConditionInput,
  toRuleInput,
  type StateRowForRules,
} from "./rule-input.js";

const NOW = new Date("2026-03-02T01:00:00Z");
const job = { approval_expiry: null, outcome_date: null };

function states(overrides: Record<string, Partial<StateRowForRules>> = {}): StateRowForRules[] {
  return CHECKPOINTS.map((c) => ({
    checkpoint_key: c.key,
    status: "not_completed" as const,
    responsibility: c.defaultResponsibility,
    decision: null,
    ...overrides[c.key],
  }));
}

describe("toRuleInput", () => {
  it("maps stored status, responsibility and decision for every known checkpoint", () => {
    const input = toRuleInput(
      job,
      states({ i2_0: { status: "completed", responsibility: null }, i1_0p: { decision: "accepted" } }),
      [],
      true,
    );
    expect(Object.keys(input.states)).toHaveLength(46);
    expect(input.states.i2_0).toEqual({ status: "completed", responsibility: null, decision: null });
    expect(input.states.i1_0p?.decision).toBe("accepted");
  });

  it("keeps an unassigned (null) responsibility instead of falling back to the definition default", () => {
    const input = toRuleInput(job, states({ i2_0: { responsibility: null } }), [], true);
    expect(effectiveState("i2_0", input).responsibility).toBeNull();
    expect(effectiveState("i2_0", toRuleInput(job, [], [], true)).responsibility).toBe("kr");
  });

  it("ignores rows for checkpoints the workflow does not define", () => {
    const input = toRuleInput(job, [...states(), { ...states()[0]!, checkpoint_key: "nope" }], [], true);
    expect(Object.keys(input.states)).not.toContain("nope");
  });

  it("carries the dates and conditions so the workflow rules exclude agencies and raise alerts", () => {
    const conditions = [{ agency: "Western Power", agency_guessed: true, is_cleared: false }];
    const input = toRuleInput({ approval_expiry: "2026-03-01", outcome_date: null }, states(), conditions, true);
    expect(effectiveState("i6_0", input).excludedByConditions).toBe(false);
    expect(effectiveState("i7_0", input)).toMatchObject({ status: "not_required", excludedByConditions: true });
    const codes = jobAlerts(input, NOW).map((a) => a.code);
    expect(codes).toEqual(["approval_expired", "conditions_agency_unchecked"]);
  });

  it("drops the decision of the fee proposal for a viewer without fee_proposal.view, and only that one", () => {
    const rows = states({ i1_0p: { decision: "declined" }, i3_0p: { decision: "declined" } });
    const hidden = toRuleInput(job, rows, [], false);
    expect(hidden.states.i1_0p?.decision).toBeNull();
    expect(hidden.states.i3_0p?.decision).toBe("declined");
    expect(summariseJob(hidden, NOW).alerts.map((a) => a.checkpointKey)).toEqual(["i3_0p"]);
    const shown = toRuleInput(job, rows, [], true);
    expect(summariseJob(shown, NOW).alerts.map((a) => a.checkpointKey)).toEqual(["i1_0p", "i3_0p"]);
  });

  it("marks the job complete only through 12.3", () => {
    const done = toRuleInput(job, states({ [JOB_COMPLETE_CHECKPOINT_KEY]: { status: "completed" } }), [], true);
    expect(summariseJob(done, NOW).isComplete).toBe(true);
    expect(summariseJob(toRuleInput(job, states(), [], true), NOW).isComplete).toBe(false);
  });
});

describe("toConditionInput", () => {
  it("maps the flags and rejects an agency outside the workflow list", () => {
    expect(toConditionInput({ agency: "WAPC", agency_guessed: false, is_cleared: true })).toEqual({
      agency: "WAPC",
      agencyGuessed: false,
      isCleared: true,
    });
    expect(() => toConditionInput({ agency: "Somebody", agency_guessed: false, is_cleared: false })).toThrow(
      RangeError,
    );
  });
});

describe("fee proposal visibility", () => {
  it("is granted by capability and restricts exactly the fee proposal checkpoint", () => {
    expect(canViewFeeProposal(jobCapabilitiesFor("staff", null))).toBe(false);
    expect(canViewFeeProposal(jobCapabilitiesFor("kr_admin", null))).toBe(true);
    expect(canViewFeeProposal(jobCapabilitiesFor("external", "client"))).toBe(true);
    expect(canViewFeeProposal(jobCapabilitiesFor("external", "architect"))).toBe(false);
    expect(isRestrictedFor("i1_0p", false)).toBe(true);
    expect(isRestrictedFor("i1_0p", true)).toBe(false);
    expect(isRestrictedFor("i2_0", false)).toBe(false);
    expect(isRestrictedFor("nope", false)).toBe(false);
  });
});
