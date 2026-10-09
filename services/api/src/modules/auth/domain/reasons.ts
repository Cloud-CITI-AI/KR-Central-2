/** Why a sign-in ended on `/sign-in-error` (PRODUCT_SPEC §3.1 step 7). The web app owns the wording per code. */

export const SIGN_IN_REASONS = [
  "cancelled",
  "wrong_tenant",
  "disabled",
  "expired",
  "unverified_email",
  "failed",
] as const;
export type SignInReason = (typeof SIGN_IN_REASONS)[number];

/** AADSTS codes Entra reports when the account does not belong to this single-tenant app's directory. */
const WRONG_TENANT = /AADSTS(?:50020|50034|90072|700016)\b/;

/** Map an `error` (and `error_description`) returned on the callback by the authorize endpoint. */
export function reasonForAuthorizeError(error: string, description?: string): SignInReason {
  if (error === "access_denied") return "cancelled";
  return description !== undefined && WRONG_TENANT.test(description) ? "wrong_tenant" : "failed";
}

export function signInErrorPath(reason: SignInReason): string {
  return `/sign-in-error?reason=${reason}`;
}
