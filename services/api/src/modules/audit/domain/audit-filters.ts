/** Audit trail filters (PRODUCT_SPEC §9.2): Perth calendar dates → UTC bounds, action prefix → LIKE pattern, id cursor. */
import { addDays, endOfBusinessDay, isIsoDate } from "@kr/workflow";

const SECOND = 1000;

/** First instant of the Perth day `isoDate` (Perth is UTC+08:00 all year; the date maths is @kr/workflow's). */
export function startOfBusinessDay(isoDate: string): Date {
  return new Date(endOfBusinessDay(addDays(isoDate, -1)).getTime() + SECOND);
}

export interface OccurredRange {
  /** Inclusive lower bound, or null. */
  readonly from: Date | null;
  /** Exclusive upper bound (the start of the day after `to`), or null. */
  readonly before: Date | null;
}

/** Both dates are inclusive Perth business dates (yyyy-mm-dd); either may be absent. Returns null for an invalid or reversed range. */
export function occurredRange(from: string | undefined, to: string | undefined): OccurredRange | null {
  if ((from !== undefined && !isIsoDate(from)) || (to !== undefined && !isIsoDate(to))) return null;
  if (from !== undefined && to !== undefined && from > to) return null;
  return {
    from: from === undefined ? null : startOfBusinessDay(from),
    before: to === undefined ? null : new Date(endOfBusinessDay(to).getTime() + SECOND),
  };
}

/** `prefix` as a literal LIKE prefix: % _ and \ lose their meaning (action names contain underscores). */
export function prefixPattern(prefix: string): string {
  return `${prefix.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** Audit ids are bigint identities; the cursor is the last id of the page. */
export function encodeAuditCursor(id: string): string {
  return Buffer.from(id, "utf8").toString("base64url");
}

export function decodeAuditCursor(raw: string): string | null {
  const id = Buffer.from(raw, "base64url").toString("utf8");
  return /^[1-9]\d{0,18}$/.test(id) && encodeAuditCursor(id) === raw ? id : null;
}
