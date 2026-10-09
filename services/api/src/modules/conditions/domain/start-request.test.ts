import { PROBLEM_TYPES } from "@kr/contracts";
import { describe, expect, it } from "vitest";
import {
  NOT_A_DECISION_LETTER,
  rejectConformanceFile,
  rejectExtractionFile,
  replaceExistingMessage,
  type RequestedFile,
} from "./start-request.js";

const JOB = "0f8fad5b-d9cb-469f-a165-70867728950e";
const letter: RequestedFile = {
  id: "5b0c3a3e-1d3f-4c58-9d0e-8d6b0b2f7a11",
  job_id: JOB,
  checkpoint_key: "i5_0",
  slot: "decision",
  original_name: "WAPC Decision Letter.pdf",
  kind: "pdf",
  scan_status: "clean",
  deleted_at: null,
};
const DELETED = new Date("2026-03-02T01:00:00Z");
const stamp: RequestedFile = { ...letter, checkpoint_key: "i4_2", slot: "conformance", original_name: "notice.pdf" };

describe("rejectExtractionFile", () => {
  it("accepts a clean PDF in the 5.0 decision slot whose name contains 'decision', in any case", () => {
    expect(rejectExtractionFile(letter, JOB)).toBeNull();
    expect(rejectExtractionFile({ ...letter, original_name: "DECISION-2026.PDF" }, JOB)).toBeNull();
    expect(rejectExtractionFile({ ...letter, scan_status: "skipped" }, JOB)).toBeNull();
  });

  it("gives the §5.5 message when the name has no 'decision'", () => {
    expect(rejectExtractionFile({ ...letter, original_name: "approval.pdf" }, JOB)).toEqual({
      type: PROBLEM_TYPES.conflict,
      detail: NOT_A_DECISION_LETTER,
    });
    expect(NOT_A_DECISION_LETTER).toBe(
      'Conditions can only be extracted from the Decision Letter – upload it with "Decision Letter" in the file name.',
    );
  });

  it.each([
    ["missing", undefined],
    ["deleted", { ...letter, deleted_at: DELETED }],
    ["from another job", { ...letter, job_id: "11111111-1111-4111-8111-111111111111" }],
    ["in another checkpoint", { ...letter, checkpoint_key: "i4_2" }],
    ["in another slot", { ...letter, slot: "other" }],
    ["evidence on a condition", { ...letter, checkpoint_key: null, slot: null }],
    ["not a PDF", { ...letter, kind: "image" as const }],
  ])("answers one 409 message for a file that is %s", (_, file) => {
    expect(rejectExtractionFile(file, JOB)).toEqual({
      type: PROBLEM_TYPES.conflict,
      detail: "Conditions can only be read from a PDF in the WAPC conditional approval box (5.0).",
    });
  });

  it("tells a pending, unscannable or infected file apart", () => {
    expect(rejectExtractionFile({ ...letter, scan_status: "pending" }, JOB)).toEqual({
      type: PROBLEM_TYPES.fileNotReady,
      detail: "WAPC Decision Letter.pdf is still being checked for viruses. Try again in a moment.",
    });
    expect(rejectExtractionFile({ ...letter, scan_status: "error" }, JOB)).toEqual({
      type: PROBLEM_TYPES.fileNotReady,
      detail: "WAPC Decision Letter.pdf couldn't be checked for viruses – remove it and upload it again",
    });
    expect(rejectExtractionFile({ ...letter, scan_status: "infected" }, JOB)).toEqual({
      type: PROBLEM_TYPES.fileRejected,
      detail: "WAPC Decision Letter.pdf was blocked because it failed the virus scan.",
    });
  });
});

describe("rejectConformanceFile", () => {
  it("accepts a clean PDF in the 4.2 slot whatever its name", () => {
    expect(rejectConformanceFile(stamp, JOB)).toBeNull();
  });

  it("rejects the decision letter's slot, other jobs, deleted and unscanned files", () => {
    const wrong = {
      type: PROBLEM_TYPES.conflict,
      detail: "The conformed date can only be read from a PDF in the Conformance Notification box (4.2).",
    };
    expect(rejectConformanceFile(letter, JOB)).toEqual(wrong);
    expect(rejectConformanceFile(stamp, "11111111-1111-4111-8111-111111111111")).toEqual(wrong);
    expect(rejectConformanceFile({ ...stamp, deleted_at: DELETED }, JOB)).toEqual(wrong);
    expect(rejectConformanceFile({ ...stamp, scan_status: "pending" }, JOB)?.type).toBe(PROBLEM_TYPES.fileNotReady);
  });
});

describe("replaceExistingMessage", () => {
  it("uses the §5.5 confirm text verbatim, with the count and no singular form", () => {
    expect(replaceExistingMessage(13)).toBe(
      "Replace the 13 existing conditions, including their ticks, comments and evidence?",
    );
    expect(replaceExistingMessage(1)).toBe(
      "Replace the 1 existing conditions, including their ticks, comments and evidence?",
    );
  });
});
