/**
 * A pasted WAPC query email (PRODUCT_SPEC §5.5 `emails`): the subject is the first line (90 characters), the file is
 * the prototype's text rendering and its name is the subject. Pure: the caller passes the time.
 */
import { BUSINESS_UTC_OFFSET, formatInstantShort, safeName } from "@kr/workflow";

/** Shown as the sender of a pasted email (the prototype's "Pasted text"). */
export const PASTED_FROM = "Pasted text";
const SUBJECT_LENGTH = 90;
const NAME_LENGTH = 80;
const RULE = "—".repeat(30);
const OFFSET_HOURS = Number.parseInt(BUSINESS_UTC_OFFSET, 10);

export interface PastedEmail {
  readonly subject: string;
  /** "<subject>.txt", safe as a file and zip entry name. */
  readonly fileName: string;
  /** What is stored: Subject / From / Date, a rule, then the pasted text. */
  readonly content: string;
}

/** "28 Sep 2026, 3:50 pm" in Perth time. */
export function formatPerthDateTime(at: Date): string {
  const local = new Date(at.getTime() + OFFSET_HOURS * 3_600_000);
  const hour = local.getUTCHours();
  const minute = String(local.getUTCMinutes()).padStart(2, "0");
  return `${formatInstantShort(at.toISOString())}, ${hour % 12 === 0 ? 12 : hour % 12}:${minute} ${hour < 12 ? "am" : "pm"}`;
}

export function buildPastedEmail(text: string, now: Date): PastedEmail {
  const subject = (text.split(/\r?\n/, 1)[0] ?? "").trim().slice(0, SUBJECT_LENGTH) || "(no subject)";
  return {
    subject,
    fileName: `${safeName(subject).slice(0, NAME_LENGTH).trimEnd()}.txt`,
    content: [
      `Subject: ${subject}`,
      `From: ${PASTED_FROM}`,
      `Date: ${formatPerthDateTime(now)}`,
      "",
      RULE,
      "",
      text,
    ].join("\n"),
  };
}
