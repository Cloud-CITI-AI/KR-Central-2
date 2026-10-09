/** Which e-mail address a sign-in carries and what it may be used for (PRODUCT_SPEC §3.1 step 4). */

const EMAIL = /^[^\s@]+@[^\s@]+$/;
const EMAIL_MAX_LENGTH = 254;

export interface EmailClaims {
  readonly isGuest: boolean;
  readonly email?: string | undefined;
  readonly preferredUsername?: string | undefined;
}

function clean(value: string | undefined): string | null {
  const v = value?.trim().toLowerCase();
  return v !== undefined && v.length <= EMAIL_MAX_LENGTH && EMAIL.test(v) ? v : null;
}

/**
 * Lower-cased address of the signed-in account. Members: the `email` claim, else `preferred_username` (the UPN, which
 * KR's tenant admins control). Guests: the `email` claim only, never the UPN of the guest object. Never an identity
 * key: it is only used for the staff-domain rule and to match pending grants.
 */
export function selectEmail(claims: EmailClaims): string | null {
  const fromClaim = clean(claims.email);
  if (claims.isGuest) return fromClaim;
  return fromClaim ?? clean(claims.preferredUsername);
}

/** Domain part of an address already cleaned by `selectEmail`. */
export function emailDomain(email: string): string {
  return email.slice(email.lastIndexOf("@") + 1);
}
