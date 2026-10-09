/** Global role of a new user and eligibility for the first-admin bootstrap (ADR-0003, PRODUCT_SPEC §2 and §3.3). */
import type { GlobalRole } from "@kr/contracts";
import { emailDomain } from "./email.js";

export interface RoleInput {
  readonly isGuest: boolean;
  /** Result of `selectEmail`. */
  readonly email: string | null;
  /** KR_STAFF_EMAIL_DOMAINS. */
  readonly staffDomains: readonly string[];
}

/** Tenant members on a KR staff domain are `staff`; guests and every other member are `external`. */
export function assignRole(input: RoleInput): Extract<GlobalRole, "staff" | "external"> {
  if (input.isGuest || input.email === null) return "external";
  const domain = emailDomain(input.email);
  return input.staffDomains.some((d) => d.trim().toLowerCase() === domain) ? "staff" : "external";
}

/** The first eligible sign-in becomes admin: a member who is staff. Guests never are, whatever their address. */
export function isFirstAdminEligible(user: { readonly isGuest: boolean; readonly role: GlobalRole }): boolean {
  return !user.isGuest && user.role === "staff";
}
