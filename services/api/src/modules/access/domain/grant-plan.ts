/**
 * What a new grant starts as (PRODUCT_SPEC §3.4, §6). A person who already has exactly one VERIFIED external account
 * under that email (the caller passes only those) is bound at once and the grant is Active; otherwise it waits as
 * Pending until a sign-in whose email the IdP verified (WP-07).
 * Two accounts with the same email are ambiguous: nothing is bound, so no one gains access by a guess.
 */
export interface GrantPlan {
  readonly status: "pending" | "active";
  readonly userId: string | null;
  readonly activatedAt: Date | null;
}

export function planGrant(externalAccountIds: readonly string[], now: Date): GrantPlan {
  const [only, ...rest] = externalAccountIds;
  if (only === undefined || rest.length > 0) return { status: "pending", userId: null, activatedAt: null };
  return { status: "active", userId: only, activatedAt: now };
}

/** The spec's duplicate message (§6): "x@y.z is already on the list for S-0001.". */
export function duplicateGrantMessage(email: string, jobNumber: string): string {
  return `${email} is already on the list for ${jobNumber}.`;
}
