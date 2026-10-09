import type { MockIdp } from "@kr/mock-idp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFactories, type Factories } from "../../../../test/factories.js";
import { apiRequest, createTestApp, signIn, testConfig, type TestApp } from "../../../../test/helpers/index.js";
import { sha256 } from "../data/auth-flows.js";
import { browserSignIn, cookieOf, mockUser, startIdpFor } from "../testing.js";

const person = mockUser(300);

describe("logout and getMe (real Postgres, mock IdP)", () => {
  let idp: MockIdp;
  let t: TestApp;
  let f: Factories;

  beforeAll(async () => {
    idp = await startIdpFor(testConfig(), [person]);
    t = await createTestApp({
      config: testConfig({
        ENTRA_AUTHORITY_HOST: idp.authorityHost,
        MALWARE_SCAN_MODE: "disabled",
        UPLOAD_MAX_BYTES: "1048576",
      }),
      flags: { "ai-stamp-reading": true },
    });
    f = createFactories(t.db);
  });
  afterAll(async () => {
    await t.close();
    await idp.stop();
  });

  it("getMe describes the signed-in user: capabilities per role, CSRF token, features, limits and session end", async () => {
    const admin = await signIn(t, await f.makeUser({ role: "admin" }));
    const res = await apiRequest(t, { url: "/v1/me", as: admin });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      user: {
        id: admin.user.id,
        displayName: admin.user.display_name,
        role: "admin",
        isGuest: false,
        status: "active",
      },
      csrfToken: admin.csrf,
      features: { aiStampReading: true, guestInvites: false, malwareScanning: false },
      uploadMaxBytes: 1_048_576,
      sessionExpiresAt: "2026-03-02T03:00:00.000Z",
    });
    expect(res.json<{ capabilities: string[] }>().capabilities).toEqual(
      expect.arrayContaining(["users.manage", "audit.read", "jobs.read_all"]),
    );
    const external = await signIn(t, await f.makeUser({ role: "external" }));
    expect((await apiRequest(t, { url: "/v1/me", as: external })).json()).toMatchObject({ capabilities: [] });
  });

  it("getMe answers 401 without a session", async () => {
    expect((await apiRequest(t, { url: "/v1/me" })).statusCode).toBe(401);
  });

  it("serves the session that a real sign-in through the mock IdP created", async () => {
    const trip = await browserSignIn(t.app, idp, { loginHint: person.oid });
    const cookie = `__Host-kr_session=${cookieOf(trip.callback, "__Host-kr_session")}`;
    const res = await t.app.inject({ url: "/v1/me", headers: { cookie } });
    const me = res.json<{ user: { email: string }; csrfToken: string }>();
    expect(me.user.email).toBe(person.email);
    const row = await t.db
      .selectFrom("sessions")
      .select("csrf_token")
      .where("id_hash", "=", sha256(cookieOf(trip.callback, "__Host-kr_session")!))
      .executeTakeFirstOrThrow();
    expect(me.csrfToken).toBe(row.csrf_token);
  });

  it("logout revokes the session, clears the cookie and returns Entra's end-session URL with the signed-out redirect", async () => {
    const me = await signIn(t, await f.makeUser());
    const res = await apiRequest(t, { method: "POST", url: "/v1/auth/logout", as: me });
    expect(res.statusCode).toBe(200);
    const target = new URL(res.json<{ redirectTo: string }>().redirectTo);
    expect(target.origin + target.pathname).toBe(`${idp.issuer}/oauth2/v2.0/logout`);
    expect(target.searchParams.get("post_logout_redirect_uri")).toBe("https://tracker.test/signed-out");
    expect(target.searchParams.get("client_id")).toBe(testConfig().ENTRA_CLIENT_ID);
    expect(res.cookies.find((c) => c.name === "__Host-kr_session")?.value).toBe("");
    const row = await t.db
      .selectFrom("sessions")
      .select(["revoked_at", "revoked_reason"])
      .where("id_hash", "=", sha256(me.cookieValue))
      .executeTakeFirstOrThrow();
    expect(row).toMatchObject({ revoked_reason: "logout" });
    expect((await apiRequest(t, { url: "/v1/me", as: me })).statusCode).toBe(401);
    // Entra's logout page, as the browser would load it, returns to the app.
    expect((await fetch(target)).status).toBe(200);
  });

  it("logout needs the CSRF token and a session", async () => {
    const me = await signIn(t, await f.makeUser());
    expect((await apiRequest(t, { method: "POST", url: "/v1/auth/logout", as: me, csrf: null })).statusCode).toBe(403);
    expect((await apiRequest(t, { url: "/v1/me", as: me })).statusCode).toBe(200);
    expect((await apiRequest(t, { method: "POST", url: "/v1/auth/logout" })).statusCode).toBe(401);
  });

  it("logout still signs the user out when Entra cannot be reached, and sends the browser to /signed-out", async () => {
    const offline = await createTestApp({ config: testConfig({ ENTRA_AUTHORITY_HOST: "http://127.0.0.1:1" }) });
    try {
      const me = await signIn(offline, await f.makeUser());
      const res = await apiRequest(offline, { method: "POST", url: "/v1/auth/logout", as: me });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ redirectTo: "https://tracker.test/signed-out" });
      expect((await apiRequest(offline, { url: "/v1/me", as: me })).statusCode).toBe(401);
    } finally {
      await offline.close();
    }
  });
});
