/**
 * What a Decision Letter extraction stores and tells the user (PRODUCT_SPEC §10.2). Pure.
 */
import type { ConditionsExtractResult } from "@kr/contracts";
import type { ApprovalDates, ParsedCondition } from "@kr/document-parsing";
import type { z } from "zod";

/** conditions.text allows 1 to 10000 characters. */
export const MAX_CONDITION_TEXT = 10_000;

export const NO_CONDITIONS_MESSAGE =
  "No numbered conditions were found in this PDF. Check it is the WAPC conditional approval letter (not a scanned image).";

/** The result stored on the operation: the contract's ConditionsExtractResult, never a local copy of it. */
export type ExtractionSummary = z.output<typeof ConditionsExtractResult>;

export function summarise(conditions: readonly ParsedCondition[], dates: ApprovalDates): ExtractionSummary {
  const guessedNumbers = conditions.filter((c) => c.agencyGuessed).map((c) => c.number);
  const message =
    conditions.length === 0
      ? NO_CONDITIONS_MESSAGE
      : guessedNumbers.length > 0
        ? `Check the agency for condition${guessedNumbers.length > 1 ? "s" : ""} ${guessedNumbers.join(", ")} – no agency was named in brackets, so it was guessed.`
        : null;
  return {
    conditionsCount: conditions.length,
    guessedNumbers,
    approvalDate: dates.approvalDate,
    approvalExpiry: dates.approvalExpiry,
    message,
  };
}

/** The text as stored: never empty, never over the column limit. Conditions without text are dropped before this. */
export function storedText(condition: ParsedCondition): string {
  return condition.text.slice(0, MAX_CONDITION_TEXT);
}

/** Conditions that can be stored (the column needs at least one character of text). */
export const storable = (conditions: readonly ParsedCondition[]): ParsedCondition[] =>
  conditions.filter((c) => c.text.trim() !== "");
