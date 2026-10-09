import { describe, expect, it } from "vitest";
import { CHECKPOINTS, getStage } from "./definition.js";
import {
  effectiveState,
  isAgencyExcluded,
  isJobComplete,
  jobAlerts,
  nextActions,
  summariseJob,
  summariseProgress,
  summariseStage,
  type CheckpointStateInput,
  type ConditionInput,
  type JobRuleInput,
} from "./rules.js";

const NOW = new Date("2026-01-10T02:00:00Z"); // 10 Jan 2026, 10:00 Perth

function job(partial: Partial<JobRuleInput> = {}): JobRuleInput {
  return { states: {}, conditions: [], approvalExpiry: null, outcomeDate: null, ...partial };
}

function done(...keys: string[]): Record<string, CheckpointStateInput> {
  return Object.fromEntries(keys.map((k) => [k, { status: "completed", responsibility: "kr" } as const]));
}

const cond = (agency: ConditionInput["agency"], extra: Partial<ConditionInput> = {}): ConditionInput => ({
  agency,
  isCleared: false,
  agencyGuessed: false,
  ...extra,
});

describe("agency exclusion", () => {
  it("does not exclude anything before conditions are extracted", () => {
    expect(isAgencyExcluded(getStage("busselton-water"), [])).toBe(false);
  });

  it("excludes optional agencies with no conditions once conditions exist", () => {
    const conditions = [cond("Local Government"), cond("Western Power")];
    expect(isAgencyExcluded(getStage("busselton-water"), conditions)).toBe(true);
    expect(isAgencyExcluded(getStage("water-corporation"), conditions)).toBe(true);
    expect(isAgencyExcluded(getStage("western-power"), conditions)).toBe(false);
    expect(isAgencyExcluded(getStage("wapc"), conditions)).toBe(false);
    expect(isAgencyExcluded(getStage("survey"), conditions)).toBe(false);
  });

  it("forces excluded checkpoints to not_required regardless of stored status", () => {
    const input = job({ states: done("i9_0"), conditions: [cond("WAPC")] });
    const s = effectiveState("i9_0", input);
    expect(s.status).toBe("not_required");
    expect(s.storedStatus).toBe("completed");
    expect(s.excludedByConditions).toBe(true);
  });

  it("falls back to the default responsibility when no state is stored", () => {
    expect(effectiveState("i1_0p", job()).responsibility).toBe("client");
    expect(effectiveState("i2_0", job()).responsibility).toBe("kr");
    expect(
      effectiveState("i2_0", job({ states: { i2_0: { status: "not_completed", responsibility: null } } }))
        .responsibility,
    ).toBeNull();
  });
});

describe("progress", () => {
  it("counts not required as progress", () => {
    const states: Record<string, CheckpointStateInput> = {
      ...done("i1_0p", "i2_0"),
      i3_0p: { status: "not_required", responsibility: "client" },
    };
    const p = summariseProgress(job({ states }));
    expect(p).toEqual({ completed: 2, notRequired: 1, notCompleted: 43, total: 46, percent: 7 });
  });

  it("summarises a stage bar", () => {
    const stage = getStage("preliminaries");
    expect(summariseStage(stage, job()).label).toBe("2 to do");
    expect(summariseStage(stage, job({ states: done("i1_0p", "i2_0") }))).toMatchObject({
      state: "completed",
      percent: 100,
      label: "Complete",
    });
    const bw = summariseStage(getStage("busselton-water"), job({ conditions: [cond("WAPC")] }));
    expect(bw).toMatchObject({
      excluded: true,
      state: "not_required",
      label: "Not required – no conditions in the Decision Letter",
    });
  });

  it("marks a job complete only when 12.3 is completed", () => {
    expect(isJobComplete(job({ states: done(...CHECKPOINTS.map((c) => c.key).filter((k) => k !== "i13_2")) }))).toBe(
      false,
    );
    expect(isJobComplete(job({ states: done("i13_2") }))).toBe(true);
  });
});

describe("next actions", () => {
  it("reports one item at a time through Preliminaries and WAPC Approval", () => {
    expect(nextActions(job()).map((n) => n.number)).toEqual(["1.0"]);
    expect(nextActions(job({ states: done("i1_0p", "i2_0", "i3_0p") })).map((n) => n.number)).toEqual(["4.0"]);
  });

  it("runs non-excluded agency stages side by side", () => {
    const before = ["i1_0p", "i2_0", "i3_0p", "i4_0", "i4_1", "i4_2", "i4_3", "i5_0"];
    const actions = nextActions(
      job({ states: done(...before, "i6_0"), conditions: [cond("Western Power"), cond("Local Government")] }),
    );
    expect(actions.map((a) => [a.number, a.stageName])).toEqual([
      ["6.1", "Western Power"],
      ["8.0", "Local Government"],
    ]);
    expect(actions[0]?.responsibility).toBe("client");
  });

  it("moves to WAPC once every agency stage is done or excluded", () => {
    const keys = CHECKPOINTS.filter((c) => ["preliminaries", "wapc-approval", "western-power"].includes(c.stage)).map(
      (c) => c.key,
    );
    expect(
      nextActions(job({ states: done(...keys), conditions: [cond("Western Power")] })).map((a) => a.number),
    ).toEqual(["10.0"]);
  });

  it("returns nothing when every checkpoint is closed", () => {
    expect(nextActions(job({ states: done(...CHECKPOINTS.map((c) => c.key)) }))).toEqual([]);
  });
});

describe("alerts", () => {
  it("flags an expired and an expiring approval", () => {
    expect(jobAlerts(job({ approvalExpiry: "2026-01-09" }), NOW)).toEqual([
      { code: "approval_expired", level: "bad", text: "WAPC approval expired Fri, 9 Jan 2026" },
    ]);
    expect(jobAlerts(job({ approvalExpiry: "2026-03-01" }), NOW)[0]).toMatchObject({
      code: "approval_expiring",
      level: "warn",
    });
    expect(jobAlerts(job({ approvalExpiry: "2027-03-01" }), NOW)).toEqual([]);
  });

  it("flags the outcome date only while 5.0 is not completed", () => {
    expect(jobAlerts(job({ outcomeDate: "2026-01-05" }), NOW)[0]?.code).toBe("outcome_passed");
    expect(jobAlerts(job({ outcomeDate: "2026-01-20" }), NOW)[0]).toEqual({
      code: "outcome_due",
      level: "warn",
      text: "WAPC outcome due in 11 days",
    });
    expect(jobAlerts(job({ outcomeDate: "2026-01-05", states: done("i5_0") }), NOW)).toEqual([]);
  });

  it("flags a client decline while the checkpoint is open, and guessed agencies", () => {
    const states = { i6_1a: { status: "not_completed", responsibility: "client", decision: "declined" } as const };
    const alerts = jobAlerts(
      job({
        states,
        conditions: [cond("Western Power", { agencyGuessed: true }), cond("WAPC", { agencyGuessed: true })],
      }),
      NOW,
    );
    expect(alerts.map((a) => a.text)).toEqual([
      "Client declined the quote (6.1)",
      "2 conditions need their agency checked",
    ]);
  });

  it("summarises a job for the dashboard", () => {
    const s = summariseJob(job(), NOW);
    expect(s.isComplete).toBe(false);
    expect(s.isWaitingOnClient).toBe(true);
    expect(s.progress.percent).toBe(0);
  });
});
