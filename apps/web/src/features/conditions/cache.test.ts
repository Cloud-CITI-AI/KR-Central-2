import { describe, expect, it } from "vitest";
import { syntheticFile } from "@/features/checkpoints/test-fixtures";
import { applyConditionEdit, mapCondition, withEvidence, withoutEvidence } from "./cache";
import { conditionAt, syntheticConditionJob } from "./test-fixtures";

const job = syntheticConditionJob({
  agencies: ["Western Power", "WAPC"],
  conditions: [{ agencyGuessed: true, krComment: "kept" }, {}],
});
const first = conditionAt(job, 0);
const second = conditionAt(job, 1);

describe("mapCondition", () => {
  it("changes one condition and leaves the others the same objects", () => {
    const changed = mapCondition(job, first.id, (c) => ({ ...c, isCleared: true }));
    expect(conditionAt(changed, 0).isCleared).toBe(true);
    expect(conditionAt(changed, 1)).toBe(second);
  });
});

describe("applyConditionEdit", () => {
  it("applies a tick, a responsibility (including none) and the comments, and keeps the version", () => {
    const edited = applyConditionEdit(job, first.id, {
      isCleared: true,
      responsibility: "client",
      krComment: "new",
      clientComment: "hello",
    });
    expect(conditionAt(edited, 0)).toMatchObject({
      isCleared: true,
      responsibility: "client",
      krComment: "new",
      clientComment: "hello",
      version: first.version,
    });
    expect(conditionAt(applyConditionEdit(edited, first.id, { responsibility: null }), 0).responsibility).toBeNull();
  });

  it("leaves what the body does not mention alone", () => {
    const edited = conditionAt(applyConditionEdit(job, first.id, { isCleared: true }), 0);
    expect(edited).toMatchObject({ krComment: "kept", agency: "Western Power", agencyGuessed: true });
  });

  it("ends the guess when the agency is chosen or confirmed", () => {
    expect(conditionAt(applyConditionEdit(job, first.id, { agency: "Local Government" }), 0)).toMatchObject({
      agency: "Local Government",
      agencyGuessed: false,
    });
    expect(conditionAt(applyConditionEdit(job, first.id, { agencyConfirmed: true }), 0)).toMatchObject({
      agency: "Western Power",
      agencyGuessed: false,
    });
  });
});

describe("withEvidence and withoutEvidence", () => {
  const file = syntheticFile(job.id, { name: "Stat dec.pdf", conditionId: first.id });

  it("adds a file to one condition once and takes it out again, leaving the others alone", () => {
    const added = withEvidence(job, first.id, file);
    expect(conditionAt(added, 0).evidence).toEqual([file]);
    expect(conditionAt(added, 1)).toBe(second);
    expect(withEvidence(added, first.id, file)).toStrictEqual(added);
    expect(conditionAt(withoutEvidence(added, first.id, file), 0).evidence).toEqual([]);
    expect(conditionAt(withoutEvidence(added, first.id, file), 1)).toBe(second);
  });
});
