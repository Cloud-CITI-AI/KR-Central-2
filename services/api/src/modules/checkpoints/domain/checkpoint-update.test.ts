import { describe, expect, it } from "vitest";
import {
  capabilitiesForUpdate,
  hasApprovalPanel,
  hasNoteBox,
  hasPaidPanel,
  planCheckpointUpdate,
  planDecision,
  planPaid,
  planUndoPaid,
} from "./checkpoint-update.js";

const NOW = new Date("2026-03-02T01:00:00Z");
const USER = "0f8fad5b-d9cb-469f-a165-70867728950e";
const open = { status: "not_completed", responsibility: "kr", kr_note: "" } as const;

describe("planCheckpointUpdate", () => {
  it("plans only the fields that differ, one audit event per field", () => {
    const p = planCheckpointUpdate(open, {
      status: "completed",
      responsibility: "client",
      krNote: "Pay $5 to the Shire",
    });
    expect(p.set).toEqual({ status: "completed", responsibility: "client", kr_note: "Pay $5 to the Shire" });
    expect(p.audits.map((a) => a.action)).toEqual([
      "checkpoint.status_changed",
      "checkpoint.responsibility_changed",
      "checkpoint.kr_note_changed",
    ]);
    expect(p.audits[0]?.changes).toEqual({ status: { from: "not_completed", to: "completed" } });
    expect(p.isNoOp).toBe(false);
  });

  it("never copies the note text into the audit trail, only its length", () => {
    const p = planCheckpointUpdate({ ...open, kr_note: "old text" }, { krNote: "new secret text" });
    expect(p.audits[0]?.changes).toEqual({ krNoteLength: { from: 8, to: 15 } });
    expect(JSON.stringify(p.audits)).not.toContain("secret");
  });

  it("can unassign a responsibility with null and treats equal values as no change", () => {
    expect(planCheckpointUpdate(open, { responsibility: null }).set).toEqual({ responsibility: null });
    expect(planCheckpointUpdate(open, { status: "not_completed", responsibility: "kr", krNote: "" }).isNoOp).toBe(true);
  });
});

describe("capabilitiesForUpdate", () => {
  it("asks for the capability of every field sent and none for fields not sent", () => {
    expect(capabilitiesForUpdate({ status: "completed" })).toEqual(["checkpoint.status.edit"]);
    expect(capabilitiesForUpdate({ responsibility: null, krNote: "" })).toEqual([
      "checkpoint.responsibility.edit",
      "checkpoint.kr_note.edit",
    ]);
    expect(capabilitiesForUpdate({ status: "not_required", responsibility: "kr", krNote: "x" })).toHaveLength(3);
  });
});

describe("panels", () => {
  it("reads approval, paid and note-box panels from the workflow definition", () => {
    expect([hasApprovalPanel("i1_0p"), hasApprovalPanel("i2_0"), hasApprovalPanel("i14_0")]).toEqual([
      true,
      false,
      false,
    ]);
    expect([hasPaidPanel("i14_0"), hasPaidPanel("i1_0p"), hasPaidPanel("i2_0")]).toEqual([true, false, false]);
    expect([hasNoteBox("i8_3"), hasNoteBox("i2_0")]).toEqual([true, false]);
  });
});

describe("planDecision", () => {
  const none = { decision: null, decision_comment: "" } as const;

  it("records who and when, and leaves the status alone (§5.5)", () => {
    const p = planDecision(none, { value: "accepted", comment: "" }, USER, NOW);
    expect(p.set).toEqual({ decision: "accepted", decision_comment: "", decided_at: NOW, decided_by: USER });
    expect(p.set).not.toHaveProperty("status");
    expect(p.audits).toEqual([
      {
        action: "checkpoint.decision_recorded",
        changes: { decision: { from: null, to: "accepted" }, commentLength: { from: 0, to: 0 } },
      },
    ]);
  });

  it("replaces an earlier decision and audits only the comment length", () => {
    const p = planDecision(
      { decision: "accepted", decision_comment: "" },
      { value: "declined", comment: "Too dear" },
      USER,
      NOW,
    );
    expect(p.audits[0]?.changes).toEqual({
      decision: { from: "accepted", to: "declined" },
      commentLength: { from: 0, to: 8 },
    });
    expect(JSON.stringify(p.audits)).not.toContain("Too dear");
  });

  it("keeps the first record when the same decision and comment arrive again", () => {
    const again = planDecision(
      { decision: "declined", decision_comment: "No" },
      { value: "declined", comment: "No" },
      USER,
      NOW,
    );
    expect(again.isNoOp).toBe(true);
    expect(
      planDecision({ decision: "declined", decision_comment: "No" }, { value: "declined", comment: "No!" }, USER, NOW)
        .isNoOp,
    ).toBe(false);
  });
});

describe("planPaid and planUndoPaid (R13)", () => {
  it("pressing the button sets the paid record and Completed", () => {
    const p = planPaid({ status: "not_completed", paid_at: null }, USER, NOW);
    expect(p.set).toEqual({ paid_at: NOW, paid_by: USER, status: "completed" });
    expect(p.audits[0]).toEqual({
      action: "checkpoint.paid_recorded",
      changes: { paidAt: { from: null, to: NOW.toISOString() }, status: { from: "not_completed", to: "completed" } },
    });
  });

  it("is idempotent: pressing again keeps the first time and who", () => {
    expect(planPaid({ status: "completed", paid_at: NOW }, "other", new Date("2027-01-01")).isNoOp).toBe(true);
  });

  it("Undo clears the paid record and sets Not completed; undoing an unpaid checkpoint is a no-op", () => {
    const p = planUndoPaid({ status: "completed", paid_at: NOW });
    expect(p.set).toEqual({ paid_at: null, paid_by: null, status: "not_completed" });
    expect(p.audits[0]?.changes).toEqual({
      paidAt: { from: NOW.toISOString(), to: null },
      status: { from: "completed", to: "not_completed" },
    });
    expect(planUndoPaid({ status: "completed", paid_at: null }).isNoOp).toBe(true);
  });
});
