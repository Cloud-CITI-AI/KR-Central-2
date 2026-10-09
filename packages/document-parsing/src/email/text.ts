/** The e-mail viewer's text (the prototype's emailText): Subject/From/To/Cc/Date, a rule, then the body. */
import type { ParsedEmail } from "../types.js";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
const PERTH_OFFSET_MS = 8 * 3_600_000;

/** "16 Mar 2026, 9:30 am" in Australia/Perth (UTC+8, no DST), independent of the server's locale and time zone. */
function perthDateTime(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return "";
  const d = new Date(ms + PERTH_OFFSET_MS);
  const hour = d.getUTCHours();
  const minute = String(d.getUTCMinutes()).padStart(2, "0");
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()] ?? ""} ${d.getUTCFullYear()}, ${hour % 12 || 12}:${minute} ${hour < 12 ? "am" : "pm"}`;
}

export function emailToText(email: ParsedEmail): string {
  const date = perthDateTime(email.date);
  return [
    `Subject: ${email.subject || "(no subject)"}`,
    ...(email.from ? [`From: ${email.from}`] : []),
    ...(email.to ? [`To: ${email.to}`] : []),
    ...(email.cc ? [`Cc: ${email.cc}`] : []),
    ...(date ? [`Date: ${date}`] : []),
    "",
    "—".repeat(30),
    "",
    email.body || "(no message text)",
  ].join("\n");
}
