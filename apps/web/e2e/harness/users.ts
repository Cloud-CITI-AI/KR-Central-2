import { randomUUID } from "node:crypto";
import type { MockUser } from "@kr/mock-idp";
import { STAFF_DOMAIN } from "./constants";

/** Synthetic people. Names and addresses are invented; none belongs to a real person or client. */
const uuid = (n: number): string => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;

/** Signs in first, so becomes `admin` (ADR-0003). MFA evidence is present so the admin pages open. */
export const FIRST_MEMBER: MockUser = {
  oid: uuid(0xa001),
  name: "Ada First",
  email: `ada.first@${STAFF_DOMAIN}`,
  preferredUsername: `ada.first@${STAFF_DOMAIN}`,
  acct: 0,
  amr: ["pwd", "mfa"],
};
export const STAFF: MockUser = {
  oid: uuid(0xa002),
  name: "Sam Staff",
  email: `sam.staff@${STAFF_DOMAIN}`,
  preferredUsername: `sam.staff@${STAFF_DOMAIN}`,
  acct: 0,
};
/** A staff member the first admin promotes to `kr_admin` while seeding. */
export const KR_ADMIN: MockUser = {
  oid: uuid(0xa003),
  name: "Kay Keeper",
  email: `kay.keeper@${STAFF_DOMAIN}`,
  preferredUsername: `kay.keeper@${STAFF_DOMAIN}`,
  acct: 0,
  amr: ["pwd", "mfa"],
};
export const CLIENT_GUEST: MockUser = {
  oid: uuid(0xb001),
  name: "Cleo Client",
  email: "cleo.client@example.com",
  preferredUsername: "cleo.client_example.com#EXT#@krsurveys.onmicrosoft.com",
  acct: 1,
};
export const ARCHITECT_GUEST: MockUser = {
  oid: uuid(0xb002),
  name: "Archie Architect",
  email: "archie.architect@example.net",
  preferredUsername: "archie.architect_example.net#EXT#@krsurveys.onmicrosoft.com",
  acct: 1,
};
/** A guest nobody has granted anything to. */
export const EXTERNAL_NO_GRANTS: MockUser = {
  oid: uuid(0xb003),
  name: "Eve External",
  email: "eve.external@example.org",
  preferredUsername: "eve.external_example.org#EXT#@krsurveys.onmicrosoft.com",
  acct: 1,
};

export const BASE_USERS: readonly MockUser[] = [
  FIRST_MEMBER,
  STAFF,
  KR_ADMIN,
  CLIENT_GUEST,
  ARCHITECT_GUEST,
  EXTERNAL_NO_GRANTS,
];

export type UserKind = "staff" | "guest";

/** A new synthetic user for one test (role changes, grant activation): unique on every call, in every process. */
export function newSyntheticUser(kind: UserKind, label: string, overrides: Partial<MockUser> = {}): MockUser {
  const id = randomUUID();
  const slug = `${label.toLowerCase().replace(/[^a-z0-9]+/g, ".")}.${id.slice(0, 6)}`;
  const name = `${label.slice(0, 1).toUpperCase()}${label.slice(1)} ${id.slice(0, 4)}`;
  const base: MockUser =
    kind === "staff"
      ? { oid: id, name, email: `${slug}@${STAFF_DOMAIN}`, preferredUsername: `${slug}@${STAFF_DOMAIN}`, acct: 0 }
      : {
          oid: id,
          name,
          email: `${slug}@example.com`,
          preferredUsername: `${slug}_example.com#EXT#@krsurveys.onmicrosoft.com`,
          acct: 1,
        };
  return { ...base, ...overrides };
}
