/**
 * Date readers (PRODUCT_SPEC §10.1, last paragraph). Pure: text in, ISO dates (yyyy-mm-dd) out.
 * Port of the prototype's datesIn / dateFromName. Invalid calendar dates are ignored.
 */
import { isIsoDate } from "@kr/workflow";

/** Accepted month spellings (full name or the usual abbreviation); the prototype also accepted any word that merely began with one. */
const MONTHS: Readonly<Record<string, number>> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

/** The year as written: two digits mean 20yy, four digits are taken as they are. */
function fullYear(text: string): number {
  return text.length === 2 ? 2000 + Number(text) : Number(text);
}

/** yyyy-mm-dd for a real calendar date, else null. */
function toIso(y: number, month: number, day: number): string | null {
  const value = `${String(y).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return isIsoDate(value) ? value : null;
}

function monthNumber(word: string): number | undefined {
  return MONTHS[word.toLowerCase()];
}

interface Hit {
  readonly index: number;
  readonly value: string;
}

/**
 * Every date in `text`, in reading order: Australian d/m/y with `/ . -` separators (2- or 4-digit year),
 * "28 July 2025", "28th Jul, 2025", "July 28, 2025" and the stamp style "16-Mar-2026".
 */
export function datesIn(text: string): string[] {
  const hits: Hit[] = [];
  for (const m of text.matchAll(/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})\b/g)) {
    const value = toIso(fullYear(m[3] ?? ""), Number(m[2]), Number(m[1]));
    if (value) hits.push({ index: m.index, value });
  }
  for (const m of text.matchAll(/\b(\d{1,2})(?:st|nd|rd|th)?[\s-]+([A-Za-z]{3,9})\.?,?[\s-]+(\d{4})\b/g)) {
    const month = monthNumber(m[2] ?? "");
    const value = month ? toIso(fullYear(m[3] ?? ""), month, Number(m[1])) : null;
    if (value) hits.push({ index: m.index, value });
  }
  for (const m of text.matchAll(/\b([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/g)) {
    const month = monthNumber(m[1] ?? "");
    const value = month ? toIso(fullYear(m[3] ?? ""), month, Number(m[2])) : null;
    if (value) hits.push({ index: m.index, value });
  }
  return hits.sort((a, b) => a.index - b.index).map((h) => h.value);
}

/** Patterns for a date inside a file name; digits next to the date make a pattern not apply (no 20260316 inside 120260316). */
const FILE_NAME_PATTERNS: readonly { readonly re: RegExp; readonly order: readonly [number, number, number] }[] = [
  { re: /(?<!\d)(20\d{2})(\d{2})(\d{2})(?!\d)/g, order: [1, 2, 3] },
  { re: /(?<!\d)(20\d{2})[-_.](\d{1,2})[-_.](\d{1,2})(?!\d)/g, order: [1, 2, 3] },
  { re: /(?<!\d)(\d{1,2})[-_.](\d{1,2})[-_.](20\d{2})(?!\d)/g, order: [3, 2, 1] },
];

/** The first real date in a file name: `20260316`, `2026-03-16`, `16-03-2026` (`_`, `.` or `-` between the parts). */
export function dateFromFileName(name: string): string | null {
  for (const { re, order } of FILE_NAME_PATTERNS) {
    for (const m of name.matchAll(re)) {
      const [y, mo, d] = order.map((i) => Number(m[i]));
      const value = toIso(y ?? 0, mo ?? 0, d ?? 0);
      if (value) return value;
    }
  }
  return null;
}
