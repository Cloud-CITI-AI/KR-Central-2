/**
 * Login CSRF (ADR-0002, PRODUCT_SPEC 3.1 step 3): an attacker starts a sign-in in their own browser, keeps the callback
 * URL Entra gives them and gets a victim's browser to open it. Without the browser-binding cookie of the browser that
 * started the flow the callback must fail closed: no session, no user changes, and the flow is spent.
 */
import type { MockIdp } from "@kr/mock-idp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp, testConfig, type TestApp } from "../helpers/index.js";
import {
  BINDING_COOKIE_NAME,
  browserSignIn,
  cookieOf,
  freshClientIp,
  mockUser,
  startIdpFor,
} from "../../src/modules/auth/testing.js";

const attacker = mockUser(41);
const victim = mockUser(42);
const EXPIRED = "/sign-in-error?reason=expired";
let idp: MockIdp;
let t: TestApp;

beforeAll(async () => {
  idp = await startIdpFor(testConfig(), [attacker, victim]);
  t = await createTestApp({ config: testConfig({ ENTRA_AUTHORITY_HOST: idp.authorityHost }) });
});
afterAll(async () => {
  await t.close();
  await idp.stop();
});

const sessionsOf = async (oid: string) =>
  t.db
    .selectFrom("sessions")
    .innerJoin("users", "users.id", "sessions.user_id")
    .select("sessions.id_hash")
    .where("users.entra_object_id", "=", oid)
    .execute();
const callbackWith = (search: string, cookie?: string, ip = freshClientIp()) =>
  t.app.inject({
    url: `/v1/auth/callback${search}`,
    headers: { "x-forwarded-for": ip, ...(cookie === undefined ? {} : { cookie: `${BINDING_COOKIE_NAME}=${cookie}` }) },
  });

describe("a callback opened in a browser that did not start the flow", () => {
  it("is refused when the browser holds no binding cookie: no session cookie, no session row, reason=expired", async () => {
    const trip = await browserSignIn(t.app, idp, { loginHint: attacker.oid, bindingCookie: null });
    expect(trip.callback.statusCode).toBe(302);
    expect(trip.callback.headers.location).toBe(EXPIRED);
    expect(cookieOf(trip.callback, "__Host-kr_session")).toBeUndefined();
    expect(await sessionsOf(attacker.oid)).toEqual([]);
  });

  it.each([
    ["an empty value", ""],
    ["a short value", "abc"],
    ["a random 256-bit value", "A".repeat(43)],
    ["a value one character too long", "A".repeat(44)],
    ["SQL text", "'; DROP TABLE auth_flows;--"],
  ])("is refused with %s as the binding cookie", async (_name, cookie) => {
    const trip = await browserSignIn(t.app, idp, { loginHint: attacker.oid, bindingCookie: cookie });
    expect(trip.callback.headers.location).toBe(EXPIRED);
    expect(cookieOf(trip.callback, "__Host-kr_session")).toBeUndefined();
  });

  it("is refused with the victim's own binding cookie, and the victim's own sign-in still works afterwards", async () => {
    let attackTrip: Awaited<ReturnType<typeof browserSignIn>> | undefined;
    const own = await browserSignIn(t.app, idp, {
      loginHint: victim.oid,
      beforeCallback: async (_url, victimStart) => {
        attackTrip = await browserSignIn(t.app, idp, {
          loginHint: attacker.oid,
          bindingCookie: cookieOf(victimStart, BINDING_COOKIE_NAME) ?? null,
        });
      },
    });
    expect(attackTrip?.callback.headers.location).toBe(EXPIRED);
    expect(cookieOf(attackTrip?.callback ?? own.callback, "__Host-kr_session")).toBeUndefined();
    expect(own.callback.headers.location).toBe("/");
    expect(cookieOf(own.callback, "__Host-kr_session")).toMatch(/^[\w-]{43}$/);
  });

  it("spends the flow: the right cookie cannot redeem the same callback afterwards, nor can the callback be replayed", async () => {
    const trip = await browserSignIn(t.app, idp, { loginHint: attacker.oid, bindingCookie: null });
    const right = cookieOf(trip.start, BINDING_COOKIE_NAME);
    expect((await callbackWith(trip.callbackUrl.search, right)).headers.location).toBe(EXPIRED);
    const ok = await browserSignIn(t.app, idp, { loginHint: attacker.oid });
    expect(cookieOf(ok.callback, "__Host-kr_session")).toBeDefined();
    expect((await callbackWith(ok.callbackUrl.search, cookieOf(ok.start, BINDING_COOKIE_NAME))).headers.location).toBe(
      EXPIRED,
    );
  });

  it("is not told apart by what the attacker adds: an error parameter still gives reason=expired", async () => {
    const trip = await browserSignIn(t.app, idp, {
      loginHint: attacker.oid,
      bindingCookie: null,
      beforeCallback: (url) => {
        url.searchParams.set("error", "access_denied");
        url.searchParams.set("error_description", "AADSTS65004 user declined");
      },
    });
    expect(trip.callback.headers.location).toBe(EXPIRED);
  });

  it("clears the binding cookie on every outcome, so a stale value is never left in the victim's browser", async () => {
    const failed = await browserSignIn(t.app, idp, { loginHint: attacker.oid, bindingCookie: null });
    const cleared = failed.callback.cookies.find((c) => c.name === BINDING_COOKIE_NAME);
    expect(cleared?.value).toBe("");
    expect(cleared?.maxAge === 0 || (cleared?.expires?.getTime() ?? Infinity) < Date.now()).toBe(true);
  });

  it("logs a security event with the reason only: no state, code or address", async () => {
    const trip = await browserSignIn(t.app, idp, {
      loginHint: attacker.oid,
      bindingCookie: null,
      forwardedFor: "198.51.100.77",
    });
    const lines = t.logLines().filter((l) => l.event === "authn_failure" && l.reason === "expired");
    expect(lines.length).toBeGreaterThan(0);
    const text = JSON.stringify(t.logLines());
    for (const secret of [
      trip.callbackUrl.searchParams.get("state"),
      trip.callbackUrl.searchParams.get("code"),
      "198.51.100.77",
    ])
      expect(text).not.toContain(secret ?? "never");
  });

  it("is refused after the ten-minute window even with the right cookie", async () => {
    const trip = await browserSignIn(t.app, idp, {
      loginHint: attacker.oid,
      beforeCallback: () => {
        t.clock.advance(11 * 60_000);
      },
    });
    expect(trip.callback.headers.location).toBe(EXPIRED);
    expect(cookieOf(trip.callback, "__Host-kr_session")).toBeUndefined();
  });
});
