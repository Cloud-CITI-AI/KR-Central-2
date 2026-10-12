/**
 * Settings of the local mock IdP (`pnpm --filter @kr/mock-idp start`, the `mock-idp` compose service): read from the same
 * `.env` the API and web read, so tenant, client and secret agree without a second copy. Synthetic people only.
 */
import type { MockIdpOptions, MockUser } from "./index.js";

const uuid = (n: number): string => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const STAFF_DOMAIN = "krsurveys.com.au";

/** The first member to sign in becomes `admin` (ADR-0003), so Ada comes first and proves MFA. */
export const LOCAL_USERS: readonly MockUser[] = [
  {
    oid: uuid(0xa001),
    name: "Ada First",
    email: `ada.first@${STAFF_DOMAIN}`,
    preferredUsername: `ada.first@${STAFF_DOMAIN}`,
    acct: 0,
    amr: ["pwd", "mfa"],
  },
  {
    oid: uuid(0xa002),
    name: "Sam Staff",
    email: `sam.staff@${STAFF_DOMAIN}`,
    preferredUsername: `sam.staff@${STAFF_DOMAIN}`,
    acct: 0,
  },
  {
    oid: uuid(0xb001),
    name: "Cleo Client",
    email: "cleo.client@example.com",
    preferredUsername: "cleo.client_example.com#EXT#@krsurveys.onmicrosoft.com",
    acct: 1,
  },
  {
    oid: uuid(0xb002),
    name: "Archie Architect",
    email: "archie.architect@example.net",
    preferredUsername: "archie.architect_example.net#EXT#@krsurveys.onmicrosoft.com",
    acct: 1,
  },
];

/** Defaults are the fake values of `.env.example`. A bad value stops the launcher instead of falling back. */
export function localOptions(env: Readonly<Record<string, string | undefined>>): MockIdpOptions {
  const value = (name: string, fallback: string): string => {
    const v = env[name];
    return v === undefined || v === "" ? fallback : v;
  };
  const portText = value("MOCK_IDP_PORT", "4010");
  const port = Number(portText);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`MOCK_IDP_PORT is not a port: ${portText}`);
  const webOrigin = new URL(value("PUBLIC_BASE_URL", "http://localhost:3000")).origin;
  const publicUrl = new URL(value("MOCK_IDP_PUBLIC_URL", `http://127.0.0.1:${portText}`));
  if (publicUrl.protocol !== "http:")
    throw new Error("MOCK_IDP_PUBLIC_URL must be http (a local mock, never deployed)");
  return {
    tenantId: value("ENTRA_TENANT_ID", uuid(1)),
    clientId: value("ENTRA_CLIENT_ID", uuid(2)),
    clientSecret: value("ENTRA_CLIENT_SECRET", "fake-client-secret-change-me"),
    users: LOCAL_USERS,
    port,
    host: value("MOCK_IDP_HOST", "127.0.0.1"),
    publicUrl: publicUrl.origin,
    redirectUris: [`${webOrigin}/api/v1/auth/callback`],
    postLogoutRedirectUris: [`${webOrigin}/signed-out`],
  };
}

/** The launcher's settings from the process environment (the only place this package reads it, BE-2). */
export function loadLocalOptions(): MockIdpOptions {
  return localOptions(process.env);
}
