/** `returnTo` after sign-in: a same-origin path only (open-redirect safe, PRODUCT_SPEC §3.1 step 1). */

export const DEFAULT_RETURN_TO = "/";
/** Mirrors auth_flows.return_to and the contract's AuthLoginQuery. */
export const RETURN_TO_MAX_LENGTH = 512;

const BASE = "https://same-origin.invalid";

/**
 * The path to redirect to, or null when `raw` is not a plain same-origin path. Absent or empty means the dashboard.
 * Rejects scheme-relative (`//host`), backslashes, whitespace and control characters (browsers fold them into `//`),
 * and anything the URL parser resolves to another origin.
 */
export function validateReturnTo(raw: string | undefined): string | null {
  if (raw === undefined || raw === "") return DEFAULT_RETURN_TO;
  if (raw.length > RETURN_TO_MAX_LENGTH || !raw.startsWith("/") || raw.startsWith("//")) return null;
  for (let i = 0; i < raw.length; i++) if (raw.charCodeAt(i) < 0x20 || raw.charCodeAt(i) === 0x7f) return null;
  if (/\s|\\/.test(raw)) return null;
  try {
    return new URL(raw, BASE).origin === BASE ? raw : null;
  } catch {
    return null;
  }
}
