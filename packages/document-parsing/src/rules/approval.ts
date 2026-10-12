/**
 * Approval and expiry dates of a WAPC conditional approval letter (PRODUCT_SPEC §10.2). Port of the prototype's
 * findApprovalDates. The outcome date is NOT read here: it comes from the conformed date (§10.1, R10), never from the letter.
 */
import { addYears } from "@kr/workflow";
import type { ApprovalDates } from "../types.js";
import { datesIn, isReadableDate } from "./dates.js";

/** The letter date is the first date in this many lines. */
const HEAD_LINES = 40;

const YEAR_WORDS: Readonly<Record<string, number>> = { one: 1, two: 2, three: 3, four: 4, five: 5 };

function expiryFromSentence(text: string): string | null {
  const m =
    /close of business on\s+([^.;]{6,30}?\d{4})/i.exec(text) ??
    /no longer be valid[^.]{0,40}?(\d{1,2}\s+[A-Za-z]+\s+\d{4})/i.exec(text) ??
    /(?:expires?|expiry)[^.]{0,30}?(\d{1,2}\s+[A-Za-z]+\s+\d{4}|\d{1,2}\/\d{1,2}\/\d{4})/i.exec(text);
  return m ? (datesIn(m[1] ?? "")[0] ?? null) : null;
}

/** "valid for two (2) years", "valid for 2 years", "valid for two years" -> 2. */
function validForYears(text: string): number {
  const phrase = /valid for\s+([^.]{1,30}?)\s*years?\b/i.exec(text)?.[1];
  if (!phrase) return 0;
  const digits = /\d{1,2}/.exec(phrase)?.[0];
  if (digits) return Number(digits);
  const word = /\b(one|two|three|four|five)\b/i.exec(phrase)?.[1];
  return word ? (YEAR_WORDS[word.toLowerCase()] ?? 0) : 0;
}

/**
 * Approval date: first date in the first 40 lines. Expiry: "close of business on <date>", "no longer be valid ... <date>",
 * "expires/expiry ... <date>"; else approval date + "valid for N years".
 */
export function findApprovalDates(lines: readonly string[]): ApprovalDates {
  const text = lines.join(" ").replace(/\s+/g, " ");
  const approvalDate = datesIn(lines.slice(0, HEAD_LINES).join("\n"))[0] ?? null;
  let approvalExpiry = expiryFromSentence(text);
  if (!approvalExpiry && approvalDate) {
    const years = validForYears(text);
    const computed = years > 0 ? addYears(approvalDate, years) : null;
    if (computed && isReadableDate(computed)) approvalExpiry = computed;
  }
  return { approvalDate, approvalExpiry };
}
