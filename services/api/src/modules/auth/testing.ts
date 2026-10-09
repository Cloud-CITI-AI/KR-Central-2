/**
 * Test support for the sign-in flow: plays the browser between the API and the mock IdP (see @kr/mock-idp). Imported
 * only by tests; nothing in the service refers to it.
 */
import { randomInt } from "node:crypto";
import pg from "pg";
import { followAuthorize, startMockIdp, type MockIdp, type MockUser } from "@kr/mock-idp";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";

export const BINDING_COOKIE_NAME = "__Host-kr_auth";

export interface BrowserOptions {
  /** `login_hint` sent to the mock IdP: whom to sign in. Absent: the IdP shows its picker (a cancelled trip). */
  readonly loginHint?: string;
  readonly returnTo?: string;
  readonly forwardedFor?: string;
  /** Extra cookies this browser already holds, e.g. an existing `__Host-kr_session`. */
  readonly cookies?: Readonly<Record<string, string>>;
  /** Cookie value presented to the callback instead of the one startLogin set (`null`: none at all). */
  readonly bindingCookie?: string | null;
  /** Runs between the IdP and the API; may rewrite the callback query (tamper with state, code ...) or the database. */
  readonly beforeCallback?: (url: URL, start: LightMyRequestResponse) => void | Promise<void>;
}

export interface BrowserTrip {
  readonly start: LightMyRequestResponse;
  readonly callbackUrl: URL;
  readonly callback: LightMyRequestResponse;
}

export function cookieOf(res: LightMyRequestResponse, name: string): string | undefined {
  return res.cookies.find((c) => c.name === name)?.value;
}

/**
 * A client address no other test file uses: the rate-limit counters live in the one database all test files share, so
 * sequential or documentation-range addresses would make parallel files throttle each other.
 */
export const freshClientIp = (): string => `10.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}`;

/** startLogin, the IdP round trip, then the callback, each as a browser would send them. */
export async function browserSignIn(app: FastifyInstance, idp: MockIdp, o: BrowserOptions = {}): Promise<BrowserTrip> {
  const forwardedFor = o.forwardedFor ?? freshClientIp();
  const query = o.returnTo === undefined ? "" : `?returnTo=${encodeURIComponent(o.returnTo)}`;
  const start = await app.inject({
    method: "GET",
    url: `/v1/auth/login${query}`,
    headers: { "x-forwarded-for": forwardedFor },
  });
  const authorizeUrl = start.headers.location;
  if (typeof authorizeUrl !== "string") throw new Error(`startLogin answered ${start.statusCode}`);
  const callbackUrl = await followAuthorize(idp, authorizeUrl, o.loginHint);
  await o.beforeCallback?.(callbackUrl, start);
  const binding = o.bindingCookie === undefined ? cookieOf(start, BINDING_COOKIE_NAME) : (o.bindingCookie ?? undefined);
  const cookies = { ...(binding === undefined ? {} : { [BINDING_COOKIE_NAME]: binding }), ...o.cookies };
  const callback = await app.inject({
    method: "GET",
    url: `/v1/auth/callback${callbackUrl.search}`,
    headers: {
      "x-forwarded-for": forwardedFor,
      cookie: Object.entries(cookies)
        .map(([k, v]) => `${k}=${v}`)
        .join("; "),
    },
  });
  return { start, callbackUrl, callback };
}

/** A synthetic account of the test tenant: member `n` of outsider.test (so never staff). Override fields per test. */
export function mockUser(n: number, o: Partial<MockUser> = {}): MockUser {
  return {
    oid: `bbbbbbbb-0000-4000-8000-${String(n).padStart(12, "0")}`,
    name: `Test Person ${n}`,
    email: `person${n}@outsider.test`,
    preferredUsername: `person${n}@outsider.test`,
    acct: 0,
    ...o,
  };
}

/** The mock IdP for the tenant, client and secret the API under test is configured with. */
export function startIdpFor(
  config: { ENTRA_TENANT_ID: string; ENTRA_CLIENT_ID: string; ENTRA_CLIENT_SECRET: string },
  users: readonly MockUser[],
): Promise<MockIdp> {
  return startMockIdp({
    tenantId: config.ENTRA_TENANT_ID,
    clientId: config.ENTRA_CLIENT_ID,
    clientSecret: config.ENTRA_CLIENT_SECRET,
    users,
  });
}

/**
 * system_bootstrap is one row for the whole (shared) test database, so test files that reset or claim it must not
 * overlap: each holds this session-level advisory lock for its whole run. Returns the release function.
 */
export async function lockBootstrap(databaseUrl: string): Promise<() => Promise<void>> {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  await client.query("SELECT pg_advisory_lock(7071)");
  return async () => {
    await client.end();
  };
}
