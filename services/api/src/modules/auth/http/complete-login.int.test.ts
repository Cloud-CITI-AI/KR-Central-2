import type { MockIdp } from "@kr/mock-idp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TEST_TENANT_ID } from "../../../../test/factories.js";
import { createTestApp, testConfig, type TestApp } from "../../../../test/helpers/index.js";
import { sha256 } from "../data/auth-flows.js";
import { browserSignIn, cookieOf, freshClientIp, mockUser, startIdpFor } from "../testing.js";

const member = mockUser(1, { amr: ["pwd", "mfa"], acrs: ["c1"] });
const EXPIRED = "/sign-in-error?reason=expired";

describe("completeLogin: sign-in and login CSRF (real Postgres, mock IdP)", () => {
  let idp: MockIdp;
  let t: TestApp;

  beforeAll(async () => {
    idp = await startIdpFor(testConfig(), [member]);
    t = await createTestApp({ config: testConfig({ ENTRA_AUTHORITY_HOST: idp.authorityHost }) });
  });
  afterAll(async () => {
    await t.close();
    await idp.stop();
  });

  const userRow = () =>
    t.db.selectFrom("users").selectAll().where("entra_object_id", "=", member.oid).executeTakeFirst();
  const sessionCount = async () => {
    const u = await userRow();
    return u ? (await t.db.selectFrom("sessions").select("id_hash").where("user_id", "=", u.id).execute()).length : 0;
  };
  const replay = (trip: Awaited<ReturnType<typeof browserSignIn>>) =>
    t.app.inject({
      url: `/v1/auth/callback${trip.callbackUrl.search}`,
      headers: { cookie: `__Host-kr_auth=${cookieOf(trip.start, "__Host-kr_auth")}` },
    });

  it("signs in: creates the user and a session with its MFA evidence, sets the cookie, redirects to returnTo", async () => {
    const trip = await browserSignIn(t.app, idp, { loginHint: member.email!, returnTo: "/jobs/abc?tab=files" });
    expect(trip.callback.statusCode).toBe(302);
    expect(trip.callback.headers.location).toBe("/jobs/abc?tab=files");
    const created = await userRow();
    expect(created).toMatchObject({
      entra_tenant_id: TEST_TENANT_ID,
      email: member.email,
      display_name: "Test Person 1",
      role: "external",
      is_guest: false,
      status: "active",
    });
    expect(created?.last_sign_in_at?.toISOString()).toBe("2026-03-02T01:00:00.000Z");

    const cookie = trip.callback.cookies.find((c) => c.name === "__Host-kr_session");
    expect(cookie).toMatchObject({ httpOnly: true, secure: true, sameSite: "Lax", path: "/" });
    expect(cookie).not.toHaveProperty("domain");
    const session = await t.db.selectFrom("sessions").selectAll().where("user_id", "=", created!.id).executeTakeFirst();
    expect(session?.id_hash.equals(sha256(cookie?.value ?? ""))).toBe(true);
    expect(session).toMatchObject({ amr: ["pwd", "mfa"], acrs: ["c1"], revoked_at: null });
    expect(Math.abs((session?.auth_time.getTime() ?? 0) - Date.now())).toBeLessThan(120_000);
    const who = await t.app.inject({ url: "/test/whoami", headers: { cookie: `__Host-kr_session=${cookie?.value}` } });
    expect(who.json()).toEqual({ userId: created?.id, role: "external" });
  });

  it("goes to the dashboard without a returnTo, clears the binding cookie and spends the flow", async () => {
    const trip = await browserSignIn(t.app, idp, { loginHint: member.email! });
    expect(trip.callback.headers.location).toBe("/");
    const cleared = trip.callback.cookies.find((c) => c.name === "__Host-kr_auth");
    expect(cleared?.value).toBe("");
    expect(cleared?.expires?.getTime()).toBeLessThan(Date.now());
    const state = sha256(trip.callbackUrl.searchParams.get("state") ?? "");
    expect(await t.db.selectFrom("auth_flows").select("nonce").where("state_hash", "=", state).execute()).toEqual([]);
  });

  it("refuses a callback without the browser-binding cookie (login CSRF): reason=expired, no session", async () => {
    const before = await sessionCount();
    const trip = await browserSignIn(t.app, idp, { loginHint: member.email!, bindingCookie: null });
    expect(trip.callback.headers.location).toBe(EXPIRED);
    expect(trip.callback.cookies.find((c) => c.name === "__Host-kr_session")).toBeUndefined();
    expect(await sessionCount()).toBe(before);
  });

  it("refuses another browser's cookie, and burns the flow so even the right browser cannot retry it", async () => {
    const before = await sessionCount();
    const other = await t.app.inject({ url: "/v1/auth/login", headers: { "x-forwarded-for": freshClientIp() } });
    const trip = await browserSignIn(t.app, idp, {
      loginHint: member.email!,
      bindingCookie: cookieOf(other, "__Host-kr_auth") ?? null,
    });
    expect(trip.callback.headers.location).toBe(EXPIRED);
    expect((await replay(trip)).headers.location).toBe(EXPIRED);
    expect(await sessionCount()).toBe(before);
  });

  it("refuses a replayed callback", async () => {
    const trip = await browserSignIn(t.app, idp, { loginHint: member.email! });
    expect(trip.callback.headers.location).toBe("/");
    expect((await replay(trip)).headers.location).toBe(EXPIRED);
  });

  it("refuses a flow older than ten minutes", async () => {
    const trip = await browserSignIn(t.app, idp, {
      loginHint: member.email!,
      beforeCallback: () => {
        t.clock.advance(601_000);
      },
    });
    expect(trip.callback.headers.location).toBe(EXPIRED);
  });

  it("maps a cancelled sign-in to reason=cancelled and still clears the binding cookie", async () => {
    const trip = await browserSignIn(t.app, idp, { loginHint: "nobody@outsider.test" });
    expect(trip.callback.headers.location).toBe("/sign-in-error?reason=cancelled");
    expect(trip.callback.cookies.find((c) => c.name === "__Host-kr_auth")?.value).toBe("");
  });
});
