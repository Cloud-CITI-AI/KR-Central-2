/**
 * The three NON-AI conformed-date candidates (PRODUCT_SPEC §10.1 steps 1, 2 and 4). Each is independent and returns
 * `{date, method}` or null. The order (file name -> stamp annotation -> AI stamp reading -> text) and the AI step
 * belong to the worker (WP-12); this package never decides the order.
 */
import type { ConformedCandidate } from "../types.js";
import { dateFromFileName, datesIn } from "./dates.js";

/** Step 1: `20260316`, `2026-03-16`, `16-03-2026` (also `_` and `.`) in the file name. */
export function fromFileName(fileName: string): ConformedCandidate<"file_name"> | null {
  const date = dateFromFileName(fileName);
  return date ? { date, method: "file_name" } : null;
}

/** Step 2: the first date in the text of the page-1 annotations (a digital stamp). */
export function fromStampAnnotation(annotationTexts: readonly string[]): ConformedCandidate<"stamp_annotation"> | null {
  const date = datesIn(annotationTexts.join("\n"))[0];
  return date ? { date, method: "stamp_annotation" } : null;
}

/** Step 4: a date on, or within 2 non-empty lines after, a line that mentions "conform". The letter date is not a fallback. */
export function fromText(lines: readonly string[]): ConformedCandidate<"text"> | null {
  const text = lines.filter((l) => l.trim() !== "");
  for (const [i, line] of text.entries()) {
    if (!/conform/i.test(line)) continue;
    const date = datesIn(line)[0] ?? datesIn(text[i + 1] ?? "")[0] ?? datesIn(text[i + 2] ?? "")[0];
    if (date) return { date, method: "text" };
  }
  return null;
}
