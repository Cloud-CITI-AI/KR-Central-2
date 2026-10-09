import type { ParsedCondition } from "@kr/document-parsing";
import { describe, expect, it } from "vitest";
import { MAX_CONDITION_TEXT, NO_CONDITIONS_MESSAGE, storable, storedText, summarise } from "./extraction.js";

const condition = (number: number, o: Partial<ParsedCondition> = {}): ParsedCondition => ({
  number,
  text: `Condition ${number}`,
  agency: "WAPC",
  agencyGuessed: false,
  ...o,
});
const dates = { approvalDate: "2026-03-16", approvalExpiry: "2028-03-16" };

describe("summarise", () => {
  it("counts the conditions and has no message when every agency was named", () => {
    expect(summarise([condition(1), condition(2)], dates)).toEqual({
      conditionsCount: 2,
      guessedNumbers: [],
      approvalDate: "2026-03-16",
      approvalExpiry: "2028-03-16",
      message: null,
    });
  });

  it("asks to check the agency of the guessed conditions, in the singular or the plural", () => {
    const one = summarise([condition(1), condition(3, { agencyGuessed: true })], dates);
    expect(one.guessedNumbers).toEqual([3]);
    expect(one.message).toBe("Check the agency for condition 3 – no agency was named in brackets, so it was guessed.");
    const two = summarise([condition(3, { agencyGuessed: true }), condition(7, { agencyGuessed: true })], dates);
    expect(two.message).toBe(
      "Check the agency for conditions 3, 7 – no agency was named in brackets, so it was guessed.",
    );
  });

  it("says so when no condition was found, but still reports the dates that were", () => {
    expect(summarise([], { approvalDate: "2026-03-16", approvalExpiry: null })).toEqual({
      conditionsCount: 0,
      guessedNumbers: [],
      approvalDate: "2026-03-16",
      approvalExpiry: null,
      message: NO_CONDITIONS_MESSAGE,
    });
  });
});

describe("what is stored", () => {
  it("cuts the text to the column limit and drops conditions with no text", () => {
    expect(storedText(condition(1, { text: "x".repeat(MAX_CONDITION_TEXT + 5) }))).toHaveLength(MAX_CONDITION_TEXT);
    expect(storable([condition(1), condition(2, { text: "  " })]).map((c) => c.number)).toEqual([1]);
  });
});
