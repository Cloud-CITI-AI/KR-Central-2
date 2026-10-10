/**
 * The parts of the permissions model the browser needs without Zod: the role lists and the capability check.
 * `@kr/contracts/capabilities` is a separate entry point (like `routes-table`) so showing or hiding a control does not
 * pull every schema into the bundle. permissions.ts builds its enums from these lists; imports nothing.
 */

/** Global role on the user record. */
export const GLOBAL_ROLES = ["admin", "kr_admin", "staff", "external"] as const;

/** Role of an external user on one job (access grant). */
export const GRANT_ROLES = ["client", "architect"] as const;

export function hasCapability<T extends string>(caps: readonly T[], cap: T): boolean {
  return caps.includes(cap);
}
