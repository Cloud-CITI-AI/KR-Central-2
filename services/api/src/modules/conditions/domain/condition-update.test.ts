import { describe, expect, it } from "vitest";
import { capabilitiesForConditionUpdate, planConditionUpdate } from "./condition-update.js";

const NOW = new Date("2026-03-02T01:00:00Z");
const USER = "0f8fad5b-d9cb-469f-a165-70867728950e";
const open = {
  is_cleared: false,
  responsibility: null,
  agency: "Western Power",
  agency_guessed: true,
  kr_comment: "",
  client_comment: "",
} as const;

describe("capabilitiesForConditionUpdate", () => {
  it("needs the client-comment capability for the client comment alone", () => {
    expect(capabilitiesForConditionUpdate({ clientComment: "Booked for May" })).toEqual([
      "conditions.client_comment.edit",
    ]);
  });

  it("needs conditions.edit for every other field, one by one", () => {
    for (const body of [
      { isCleared: true },
      { responsibility: "kr" as const },
      { responsibility: null },
      { krComment: "x" },
      { agency: "WAPC" as const },
      { agencyConfirmed: true as const },
    ]) {
      expect(capabilitiesForConditionUpdate(body), JSON.stringify(body)).toEqual(["conditions.edit"]);
    }
  });

  it("needs both for a request that mixes them", () => {
    expect(capabilitiesForConditionUpdate({ clientComment: "x", isCleared: true })).toEqual([
      "conditions.client_comment.edit",
      "conditions.edit",
    ]);
  });
});

describe("planConditionUpdate", () => {
  it("ticking records who and when; unticking clears both", () => {
    const ticked = planConditionUpdate(open, { isCleared: true }, USER, NOW);
    expect(ticked.set).toEqual({ is_cleared: true, cleared_at: NOW, cleared_by: USER });
    expect(ticked.changes).toEqual({ isCleared: { from: false, to: true } });
    const unticked = planConditionUpdate({ ...open, is_cleared: true }, { isCleared: false }, USER, NOW);
    expect(unticked.set).toEqual({ is_cleared: false, cleared_at: null, cleared_by: null });
  });

  it("choosing an agency clears the guessed flag; confirming does too without changing the agency", () => {
    const chosen = planConditionUpdate(open, { agency: "Water Corporation" }, USER, NOW);
    expect(chosen.set).toEqual({ agency: "Water Corporation", agency_guessed: false });
    expect(chosen.changes).toEqual({
      agency: { from: "Western Power", to: "Water Corporation" },
      agencyGuessed: { from: true, to: false },
    });
    const confirmed = planConditionUpdate(open, { agencyConfirmed: true }, USER, NOW);
    expect(confirmed.set).toEqual({ agency_guessed: false });
    expect(planConditionUpdate(open, { agency: "Western Power" }, USER, NOW).set).toEqual({ agency_guessed: false });
  });

  it("changes the agency of a condition that was never guessed without touching the flag", () => {
    const p = planConditionUpdate({ ...open, agency_guessed: false }, { agency: "WAPC" }, USER, NOW);
    expect(p.set).toEqual({ agency: "WAPC" });
  });

  it("records responsibility including unassigning with null", () => {
    expect(planConditionUpdate(open, { responsibility: "client" }, USER, NOW).changes).toEqual({
      responsibility: { from: null, to: "client" },
    });
    const back = planConditionUpdate({ ...open, responsibility: "kr" }, { responsibility: null }, USER, NOW);
    expect(back.changes).toEqual({ responsibility: { from: "kr", to: null } });
  });

  it("never copies comment text into the audit trail, only its length", () => {
    const p = planConditionUpdate(
      { ...open, kr_comment: "old", client_comment: "" },
      { krComment: "Pay the $5000 bond", clientComment: "Private note" },
      USER,
      NOW,
    );
    expect(p.set).toMatchObject({ kr_comment: "Pay the $5000 bond", client_comment: "Private note" });
    expect(p.changes).toEqual({
      krCommentLength: { from: 3, to: 18 },
      clientCommentLength: { from: 0, to: 12 },
    });
    expect(JSON.stringify(p.changes)).not.toMatch(/bond|Private/);
  });

  it("plans nothing when every sent value equals the stored one", () => {
    const same = planConditionUpdate(
      { ...open, is_cleared: true, responsibility: "kr", agency_guessed: false, kr_comment: "a", client_comment: "b" },
      { isCleared: true, responsibility: "kr", agency: "Western Power", krComment: "a", clientComment: "b" },
      USER,
      NOW,
    );
    expect(same).toEqual({ set: {}, changes: null });
  });
});
