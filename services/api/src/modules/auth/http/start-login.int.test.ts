import { createHash } from "node:crypto";
import { startMockIdp, type MockIdp } from "@kr/mock-idp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { freshClientIp } from "../testing.js";
import { createTestApp, schemaViolations, testConfig, type TestApp } from "../../../../test/helpers/index.js";

const sha256 = (v: string) => createHash("sha256").update(v).digest();

const idpOptions = () => {
  const c = testConfig();
  return { tenantId: c.ENTRA_TENANT_ID, clientId: c.ENTRA_CLIENT_ID, clientSecret: c.ENTRA_CLIENT_SECRET };
};

describe("startLogin (real Postgres, mock IdP)", () => {
  let idp: MockIdp;
  let t: TestApp;
  const config = () => testConfig({ ENTRA_AUTHORITY_HOST: idp.authorityHost });

  beforeAll(async () => {
    idp = await startMockIdp({ ...idpOptions(), users: [] });
    t = await createTestApp({ config: config() });
  });
  afterAll(async () => {
    await t.close();
    await idp.stop();
  });

  const start = (url = "/v1/auth/login", forwardedFor = freshClientIp()) =>
    t.app.inject({ method: "GET", url, headers: { "x-forwarded-for": forwardedFor } });
  const flowFor = (state: string) =>
    t.db.selectFrom("auth_flows").selectAll().where("state_hash", "=", sha256(state)).executeTakeFirst();

  it("redirects to the Entra authorize endpoint with code flow, PKCE S256, state, nonce and the scopes", async () => {
    const res = await start();
    expect(res.statusCode).toBe(302);
    const location = new URL(res.headers.location!);
    expect(location.origin + location.pathname).toBe(`${idp.issuer}/oauth2/v2.0/authorize`);
    expect(Object.fromEntries(location.searchParams)).toMatchObject({
      client_id: config().ENTRA_CLIENT_ID,
      response_type: "code",
      redirect_uri: "https://tracker.test/api/v1/auth/callback",
      scope: "openid profile email",
      code_challenge_method: "S256",
    });
    for (const p of ["state", "nonce", "code_challenge"]) expect(location.searchParams.get(p)).toMatch(/^[\w-]{43}$/);
  });

  it("stores the flow (hashed state, nonce, verifier, returnTo, hashed binding value) for ten minutes", async () => {
    const res = await start("/v1/auth/login?returnTo=%2Fjobs%2Fabc%3Ftab%3Dfiles");
    const location = new URL(res.headers.location!);
    const flow = await flowFor(location.searchParams.get("state") ?? "");
    expect(flow).toMatchObject({ nonce: location.searchParams.get("nonce"), return_to: "/jobs/abc?tab=files" });
    expect(
      createHash("sha256")
        .update(flow?.code_verifier ?? "")
        .digest("base64url"),
    ).toBe(location.searchParams.get("code_challenge"));
    expect(flow?.expires_at.toISOString()).toBe("2026-03-02T01:10:00.000Z");
    const binding = res.cookies.find((c) => c.name === "__Host-kr_auth");
    expect(flow?.browser_binding_hash.equals(sha256(binding?.value ?? ""))).toBe(true);
  });

  it("defaults returnTo to the dashboard", async () => {
    const res = await start();
    const flow = await flowFor(new URL(res.headers.location!).searchParams.get("state") ?? "");
    expect(flow?.return_to).toBe("/");
  });

  it("sets the browser-binding cookie: 256 random bits, HttpOnly, Secure, SameSite=Lax, Path=/, 10 minutes, no Domain", async () => {
    const [a, b] = [await start(), await start()];
    const cookie = a.cookies.find((c) => c.name === "__Host-kr_auth");
    expect(cookie).toMatchObject({ httpOnly: true, secure: true, sameSite: "Lax", path: "/", maxAge: 600 });
    expect(cookie?.value).toMatch(/^[\w-]{43}$/);
    expect(cookie).not.toHaveProperty("domain");
    expect(cookie?.value).not.toBe(b.cookies.find((c) => c.name === "__Host-kr_auth")?.value);
  });

  it.each(["//evil.test/x", "https://evil.test/", "/\\evil.test", "jobs", "/a b"])(
    "refuses returnTo %j with a 400 problem and sets no cookie",
    async (returnTo) => {
      const res = await start(`/v1/auth/login?returnTo=${encodeURIComponent(returnTo)}`);
      expect(res.statusCode).toBe(400);
      expect(res.headers["content-type"]).toContain("application/problem+json");
      expect(schemaViolations("Problem", res.json())).toEqual([]);
      expect(res.cookies.find((c) => c.name === "__Host-kr_auth")).toBeUndefined();
    },
  );

  it("rate-limits sign-in starts per client IP", async () => {
    const limited = await createTestApp({
      config: testConfig({ ENTRA_AUTHORITY_HOST: idp.authorityHost, RATE_LIMIT_SIGNIN_PER_MINUTE_PER_IP: "2" }),
    });
    try {
      const ipAddress = freshClientIp();
      const get = () =>
        limited.app.inject({ method: "GET", url: "/v1/auth/login", headers: { "x-forwarded-for": ipAddress } });
      expect([(await get()).statusCode, (await get()).statusCode]).toEqual([302, 302]);
      const third = await get();
      expect(third.statusCode).toBe(429);
      expect(third.headers["retry-after"]).toBeDefined();
    } finally {
      await limited.close();
    }
  });

  it("answers 503 when the identity provider is unreachable", async () => {
    const down = await createTestApp({ config: testConfig({ ENTRA_AUTHORITY_HOST: "http://127.0.0.1:1" }) });
    try {
      expect(
        (
          await down.app.inject({
            method: "GET",
            url: "/v1/auth/login",
            headers: { "x-forwarded-for": freshClientIp() },
          })
        ).statusCode,
      ).toBe(503);
    } finally {
      await down.close();
    }
  });

  it("discovers once and keeps using the cached metadata after the identity provider stops", async () => {
    const own = await startMockIdp({ ...idpOptions(), users: [] });
    const app = await createTestApp({ config: testConfig({ ENTRA_AUTHORITY_HOST: own.authorityHost }) });
    try {
      const get = () =>
        app.app.inject({ method: "GET", url: "/v1/auth/login", headers: { "x-forwarded-for": freshClientIp() } });
      expect((await get()).statusCode).toBe(302);
      await own.stop();
      expect((await get()).statusCode).toBe(302);
    } finally {
      await app.close();
    }
  });
});
