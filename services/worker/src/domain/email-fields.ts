/**
 * The columns of email_messages from a parsed email (PRODUCT_SPEC §10.3, DATA_MODEL). Pure. Postgres text cannot hold a
 * NUL character, and the columns have length checks, so both are enforced here instead of failing the insert.
 */
import type { ParsedEmail } from "@kr/document-parsing";

export interface EmailFields {
  readonly subject: string;
  readonly from_text: string | null;
  readonly to_text: string | null;
  readonly cc_text: string | null;
  readonly sent_at: Date | null;
  readonly body_text: string | null;
}

/** Column limits of email_messages. */
export const LIMITS = { subject: 1000, from: 1000, to: 4000, cc: 4000, body: 500_000 } as const;

const NUL = /\0/g;
const LONE_HIGH_SURROGATE_AT_END = /[\ud800-\udbff]$/;
const FIRST_YEAR = 1990;
const LAST_YEAR = 2100;

/** NUL-free, cut to `max` characters without splitting a surrogate pair; null when nothing is left. */
function clean(value: string, max: number): string | null {
  const text = value.replace(NUL, "").slice(0, max).replace(LONE_HIGH_SURROGATE_AT_END, "");
  return text.trim() === "" ? null : text;
}

/** The sent time when it is a real instant in a plausible range. */
function instant(iso: string): Date | null {
  const date = new Date(Date.parse(iso));
  const year = date.getUTCFullYear();
  return Number.isNaN(date.getTime()) || year < FIRST_YEAR || year > LAST_YEAR ? null : date;
}

export function toEmailFields(email: ParsedEmail): EmailFields {
  return {
    subject: clean(email.subject, LIMITS.subject) ?? "(no subject)",
    from_text: clean(email.from, LIMITS.from),
    to_text: clean(email.to, LIMITS.to),
    cc_text: clean(email.cc, LIMITS.cc),
    sent_at: instant(email.date),
    body_text: clean(email.body, LIMITS.body),
  };
}
