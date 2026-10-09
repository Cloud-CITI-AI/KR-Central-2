/**
 * Date rules. KR Surveys works in Western Australia: business dates are interpreted in Australia/Perth,
 * which is UTC+08:00 all year (no daylight saving), so a fixed offset is exact.
 * All functions take `now` explicitly (playbook TD-4: no Date.now() in domain code).
 */
import { WAPC_DECISION_DAYS } from "./definition.js";

export const BUSINESS_TIME_ZONE = "Australia/Perth";
export const BUSINESS_UTC_OFFSET = "+08:00";
const MS_PER_DAY = 86_400_000;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True for a real calendar date in yyyy-mm-dd form. */
export function isIsoDate(value: string): boolean {
  const m = ISO_DATE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

function assertIsoDate(value: string): void {
  if (!isIsoDate(value)) throw new RangeError(`Not an ISO date (yyyy-mm-dd): ${value}`);
}

/** Calendar addition on an ISO date. */
export function addDays(isoDate: string, days: number): string {
  assertIsoDate(isoDate);
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Calendar addition of whole years (approval valid for N years). 29 Feb rolls to 1 Mar like the prototype. */
export function addYears(isoDate: string, years: number): string {
  assertIsoDate(isoDate);
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() + years);
  return d.toISOString().slice(0, 10);
}

/** WAPC outcome date = conformed date + 90 days. */
export function outcomeDateFor(conformedDate: string): string {
  return addDays(conformedDate, WAPC_DECISION_DAYS);
}

/** Instant at which the given business date ends (23:59:59 Perth time). */
export function endOfBusinessDay(isoDate: string): Date {
  assertIsoDate(isoDate);
  return new Date(`${isoDate}T23:59:59${BUSINESS_UTC_OFFSET}`);
}

/** Today's date in Perth (yyyy-mm-dd). */
export function businessToday(now: Date): string {
  return new Date(now.getTime() + 8 * 3_600_000).toISOString().slice(0, 10);
}

/**
 * Whole days until the end of `isoDate` (Perth), rounded up — the prototype's
 * Math.ceil((end - now) / 86400000). Once the day has passed the result is negative: -1 on the day after,
 * and so on. (Deviation from the prototype, which reported "0 days" for the whole day after — see spec §6.)
 */
export function daysUntilEndOfDay(isoDate: string, now: Date): number {
  const diff = endOfBusinessDay(isoDate).getTime() - now.getTime();
  return diff >= 0 ? Math.ceil(diff / MS_PER_DAY) : -Math.ceil(-diff / MS_PER_DAY);
}

export type ExpiryLevel = "ok" | "soon" | "past";

export interface ApprovalExpiryStatus {
  readonly days: number;
  readonly level: ExpiryLevel;
  /** "768 days left to lodge Form 1C" / "1 day left to lodge Form 1C" / "Expired 3 days ago". */
  readonly text: string;
}

/** Summary-panel text under "Approval expiry". soon = fewer than 180 days. */
export function approvalExpiryStatus(expiry: string, now: Date): ApprovalExpiryStatus {
  const days = daysUntilEndOfDay(expiry, now);
  if (days < 0) {
    const ago = -days;
    return { days, level: "past", text: `Expired ${ago} day${ago === 1 ? "" : "s"} ago` };
  }
  const level: ExpiryLevel = days < 180 ? "soon" : "ok";
  return { days, level, text: `${days.toLocaleString("en-AU")} day${days === 1 ? "" : "s"} left to lodge Form 1C` };
}

export interface Countdown {
  readonly days: number;
  readonly hours: number;
  readonly minutes: number;
  readonly seconds: number;
  /** past = outcome date has passed; soon = fewer than 14 days left; ok otherwise. */
  readonly state: ExpiryLevel;
  /** "until outcome date – Sun, 26 Oct 2025" / "Outcome date passed – Sun, 26 Oct 2025". */
  readonly caption: string;
}

/** The live WAPC outcome countdown (days/hrs/min/sec to the end of the outcome date). */
export function outcomeCountdown(outcomeDate: string, now: Date): Countdown {
  let ms = endOfBusinessDay(outcomeDate).getTime() - now.getTime();
  const past = ms < 0;
  ms = Math.abs(ms);
  const days = Math.floor(ms / MS_PER_DAY);
  const hours = Math.floor(ms / 3_600_000) % 24;
  const minutes = Math.floor(ms / 60_000) % 60;
  const seconds = Math.floor(ms / 1000) % 60;
  const state: ExpiryLevel = past ? "past" : days < 14 ? "soon" : "ok";
  const when = formatDateWithWeekday(outcomeDate);
  return {
    days,
    hours,
    minutes,
    seconds,
    state,
    caption: past ? `Outcome date passed – ${when}` : `until outcome date – ${when}`,
  };
}

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
const WEEKDAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/** "Sun, 26 Oct 2025" — deterministic (no ICU dependency) so server and browser render identically. */
export function formatDateWithWeekday(isoDate: string): string {
  assertIsoDate(isoDate);
  const d = new Date(`${isoDate}T00:00:00Z`);
  return `${WEEKDAYS_SHORT[d.getUTCDay()] ?? ""}, ${d.getUTCDate()} ${MONTHS_SHORT[d.getUTCMonth()] ?? ""} ${d.getUTCFullYear()}`;
}

/** Alias used by alert texts (prototype fmtDate). */
export const formatDateLong = formatDateWithWeekday;

/** "28 Sep 2026" from an ISO instant, in Perth time (decision / paid dates). */
export function formatInstantShort(isoInstant: string): string {
  const d = new Date(new Date(isoInstant).getTime() + 8 * 3_600_000);
  return `${d.getUTCDate()} ${MONTHS_SHORT[d.getUTCMonth()] ?? ""} ${d.getUTCFullYear()}`;
}
