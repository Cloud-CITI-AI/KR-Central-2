/**
 * Decision Letter conditions (PRODUCT_SPEC §10.2). Port of the prototype's parseConditions / agencyFrom / guessAgency.
 * Pure: takes the PDF's text lines (page breaks as empty lines) and returns the numbered conditions.
 */
import type { Agency } from "@kr/workflow";
import type { ParsedCondition } from "../types.js";

/** Page footers: "Page 3 of 5", page numbers and the OFFICIAL / UNOFFICIAL: Sensitive marking. */
const PAGE_LINES = [/^page \d+$/i, /^page \d+ of \d+$/i];
const FOOTER_LINES = [/^\d{1,3}$/, /^\d{0,3}\s*(?:(?:un)?official:?\s*sensitive|(?:un)?official)\s*\d{0,3}$/i];
/** A footer that was glued into the condition text: "... within 6 months 3 OFFICIAL". */
const EMBEDDED_FOOTER = /\s\d{1,3}\s+(?:(?:un)?official:?\s*sensitive|(?:un)?official)\b/gi;

const isFooter = (line: string): boolean => [...PAGE_LINES, ...FOOTER_LINES].some((re) => re.test(line));

/** The agency named inside a bracketed group, e.g. "Western Power", "City of Stirling" (Local Government). */
export function agencyFrom(text: string): Agency | null {
  const t = text.toLowerCase();
  if (t.includes("busselton water")) return "Busselton Water";
  if (t.includes("western power")) return "Western Power";
  if (t.includes("water corp")) return "Water Corporation";
  if (/planning commission|\bwapc\b/.test(t)) return "WAPC";
  if (/local government|\bshire\b|\bcity of\b|\btown of\b|\bcouncil\b/.test(t)) return "Local Government";
  return null;
}

/** Keyword guess used when no agency is named in brackets (the caller marks it `agencyGuessed`). */
export function guessAgency(text: string): Agency {
  const t = text.toLowerCase();
  if (/electric|power supply|western power/.test(t)) return "Western Power";
  if (t.includes("busselton water")) return "Busselton Water";
  if (/sewer|wastewater|water corporation/.test(t)) return "Water Corporation";
  if (/water supply|potable/.test(t)) return t.includes("busselton") ? "Busselton Water" : "Water Corporation";
  if (/crossover|drainage|verge|kerb|road|footpath|local government|council|shire/.test(t)) return "Local Government";
  return "WAPC";
}

/** The responsible agency is the LAST bracketed group that names one, even if stray text follows it. */
function namedAgency(text: string): Agency | null {
  let named: Agency | null = null;
  for (const m of text.matchAll(/\(([^()]{3,80})\)/g)) named = agencyFrom(m[1] ?? "") ?? named;
  return named;
}

/**
 * Conditions start after the first short line matching `^conditions?\b` (else at the top) and stop at the next line
 * matching `^advice\b`. A line `^(\d{1,2})[.)]` starts condition n only when n = previous + 1; other lines continue
 * the current condition. Advice notes and page footers are not part of any condition.
 */
export function parseConditions(lines: readonly string[]): ParsedCondition[] {
  const heading = lines.findIndex((l) => /^conditions?\b/i.test(l) && l.length < 60);
  const start = heading < 0 ? 0 : heading + 1;
  const advice = lines.findIndex((l, i) => i >= start && /^advice\b/i.test(l));
  const end = advice < 0 ? lines.length : advice;

  const raw: { number: number; text: string }[] = [];
  for (const line of lines.slice(start, end)) {
    if (!line || isFooter(line)) continue;
    const m = /^(\d{1,2})[.)](?!\d)\s*(.*)$/.exec(line);
    const current = raw.at(-1);
    if (m && Number(m[1]) === raw.length + 1) raw.push({ number: Number(m[1]), text: m[2] ?? "" });
    else if (current) current.text += ` ${line}`;
  }

  return raw.map(({ number, text: rawText }) => {
    const text = rawText.replace(EMBEDDED_FOOTER, "").replace(/\s+/g, " ").trim();
    const named = namedAgency(text);
    return { number, text, agency: named ?? guessAgency(text), agencyGuessed: named === null };
  });
}
