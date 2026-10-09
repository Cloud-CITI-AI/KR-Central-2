/** Today's date in Perth (UTC+8, no DST) as yyyy-mm-dd: the business date the application itself uses (PRODUCT_SPEC §12). */
export function perthToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Perth",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** The digits-only form of an ISO date, as in a file name ("20260316"). */
export const compactDate = (isoDate: string): string => isoDate.replaceAll("-", "");
