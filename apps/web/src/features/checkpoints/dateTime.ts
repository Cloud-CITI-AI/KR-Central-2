import { formatInstantShort } from "@kr/workflow";

const PERTH_OFFSET_MS = 8 * 3_600_000;

/** "28 Sep 2026, 3:50 pm" from an ISO instant, in Perth time (the email meta line, §5.5); deterministic, no ICU. */
export function formatInstantDateTime(isoInstant: string): string {
  const local = new Date(new Date(isoInstant).getTime() + PERTH_OFFSET_MS);
  const hours = local.getUTCHours();
  const minutes = String(local.getUTCMinutes()).padStart(2, "0");
  return `${formatInstantShort(isoInstant)}, ${hours % 12 === 0 ? 12 : hours % 12}:${minutes} ${hours < 12 ? "am" : "pm"}`;
}
