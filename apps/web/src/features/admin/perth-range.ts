import { addDays, BUSINESS_UTC_OFFSET, isIsoDate } from "@kr/workflow";

/** A range of Perth business dates as UTC instants (ms): `from` is inclusive, `to` is exclusive; a missing end is open. */
export interface InstantRange {
  readonly from?: number;
  readonly to?: number;
}

/**
 * Start of the Perth date `from` and start of the day after the Perth date `to` (yyyy-mm-dd, either may be empty).
 * Invalid dates are open. The end is exclusive so an event in the last second (23:59:59.5) is still inside the day.
 */
export function perthDateRange(from: string, to: string): InstantRange {
  return {
    ...(isIsoDate(from) ? { from: Date.parse(`${from}T00:00:00${BUSINESS_UTC_OFFSET}`) } : {}),
    ...(isIsoDate(to) ? { to: Date.parse(`${addDays(to, 1)}T00:00:00${BUSINESS_UTC_OFFSET}`) } : {}),
  };
}

export function isInRange(isoInstant: string, range: InstantRange): boolean {
  const at = Date.parse(isoInstant);
  return (range.from === undefined || at >= range.from) && (range.to === undefined || at < range.to);
}
