/** Which e-mail address a sign-in carries and what it may be used for (PRODUCT_SPEC §3.1 step 4). */

const EMAIL = /^[^\s@]+@[^\s@]+$/;
const EMAIL_MAX_LENGTH = 254;

export interface EmailClaims {
  readonly isGuest: boolean;
  readonly email?: string | undefined;
  readonly preferredUsername?: string | undefined;
  /** False when the token says `xms_edov=false`. Defaults to true. */
  readonly emailVerified?: boolean | undefined;
}

function clean(value: string | undefined): string | null {
  const v = value?.trim().toLowerCase();
  return v !== undefined && v.length <= EMAIL_MAX_LENGTH && EMAIL.test(v) ? v : null;
}

/**
 * Lower-cased address of the signed-in account. Members: the `email` claim, else `preferred_username` (the UPN, which
 * KR's tenant admins control); when the token says the email's domain is unverified (`xms_edov=false`) the `email`
 * claim is ignored and the UPN is used, because the UPN's domain is always verified in KR's tenant. Guests: the
 * `email` claim only, never the UPN of the guest object. Never an identity key: it is only used for the staff-domain
 * rule and to match pending grants.
 */
export function selectEmail(claims: EmailClaims): string | null {
  const fromClaim = clean(claims.email);
  if (claims.isGuest) return fromClaim;
  const fromUpn = clean(claims.preferredUsername);
  return claims.emailVerified === false ? fromUpn : (fromClaim ?? fromUpn);
}

/** Domain part of an address already cleaned by `selectEmail`. */
export function emailDomain(email: string): string {
  return email.slice(email.lastIndexOf("@") + 1);
}
