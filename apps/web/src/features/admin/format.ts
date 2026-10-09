import type { GlobalRole } from "@kr/contracts";
import { BUSINESS_UTC_OFFSET, formatInstantShort } from "@kr/workflow";

/** Role names as people say them (§2); the contract's keys are `admin`, `kr_admin`, `staff` and `external`. */
export const ROLE_LABELS: Record<GlobalRole, string> = {
  admin: "Admin",
  kr_admin: "KR Admin",
  staff: "Staff",
  external: "External",
};

/** Perth's distance from UTC in ms, taken from @kr/workflow's BUSINESS_UTC_OFFSET so the offset has one source. */
const PERTH_OFFSET_MS = -Date.parse(`1970-01-01T00:00:00${BUSINESS_UTC_OFFSET}`);
const pad = (n: number): string => String(n).padStart(2, "0");

/** "28 Sep 2026, 11:50 am" in Perth time (§12); `seconds` adds ":12" for the audit trail. Deterministic, no ICU. */
export function formatPerthDateTime(isoInstant: string, { seconds = false } = {}): string {
  const perth = new Date(new Date(isoInstant).getTime() + PERTH_OFFSET_MS);
  const hour = perth.getUTCHours();
  const clock = `${hour % 12 === 0 ? 12 : hour % 12}:${pad(perth.getUTCMinutes())}${seconds ? `:${pad(perth.getUTCSeconds())}` : ""}`;
  return `${formatInstantShort(isoInstant)}, ${clock} ${hour < 12 ? "am" : "pm"}`;
}
