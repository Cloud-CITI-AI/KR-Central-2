/**
 * Sessions (ADR-0002, ASVS V7): opaque random ids that are stored only as hashes, issued fresh on every sign-in, ended by
 * logout, by role change and by disabling the account, and limited by an idle timeout and an absolute lifetime.
 */
import { createHash } from "node:crypto";
import type { MockIdp } from "@kr/mock-idp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BINDING_COOKIE_NAME, browserSignIn, cookieOf, mockUser, startIdpFor } from "../../src/modules/auth/testing.js";
import { apiRequest, signIn, testConfig, type SignedIn } from "../helpers/index.js";
import { createWorld, type World } from "./support.js";

const COOKIE = "__Host-kr_session";
const person = mockUser(51);
let idp: MockIdp;
let w: World;
beforeAll(async () => {
  idp = await startIdpFor(testConfig(), [person]);
  w = await createWorld({ ENTRA_AUTHORITY_HOST: idp.authorityHost });
});
afterAll(async () => {
  await w.t.close();
  await idp.stop();
});

const me = (who: Pick<SignedIn, "cookie">) => w.t.app.inject({ url: "/v1/me", headers: { cookie: who.cookie } });
const row = (cookieValue: string) =>
  w.t.db
    .selectFrom("sessions")
    .selectAll()
    .where("id_hash", "=", createHash("sha256").update(cookieValue).digest())
    .executeTakeFirstOrThrow();
const newUser = async (role: "admin" | "staff" | "external" = "staff") => signIn(w.t, await w.f.makeUser({ role }));

describe("the cookie a real sign-in sets", () => {
  it("is __Host-, HttpOnly, Secure, SameSite=Lax, Path=/, without Domain or Max-Age, with 256 random bits", async () => {
    const trip = await browserSignIn(w.t.app, idp, { loginHint: person.oid });
    const cookie = trip.callback.cookies.find((c) => c.name === COOKIE);
    expect(cookie).toMatchObject({ httpOnly: true, secure: true, sameSite: "Lax", path: "/" });
    expect(cookie).not.toHaveProperty("domain");
    expect(cookie).not.toHaveProperty("maxAge");
    expect(cookie?.value).toMatch(/^[\w-]{43}$/);
  });

  it("is stored only as its SHA-256: the database holds neither the cookie nor the CSRF token's use as a cookie", async () => {
    const trip = await browserSignIn(w.t.app, idp, { loginHint: person.oid });
    const value = cookieOf(trip.callback, COOKIE) ?? "";
    const stored = await row(value);
    expect(stored.id_hash).toEqual(createHash("sha256").update(value).digest());
    expect(JSON.stringify(stored)).not.toContain(value);
    expect(trip.callback.headers["set-cookie"]).not.toContain(stored.csrf_token);
  });

  it("is new on every sign-in, with its own CSRF token (ids and tokens never repeat)", async () => {
    const seen = new Set<string>();
    for (let i = 0; i < 25; i++) {
      const s = await newUser();
      seen.add(s.cookieValue).add(s.csrf);
    }
    expect(seen.size).toBe(50);
  });
});

describe("session fixation", () => {
  it("never adopts a cookie planted before sign-in: the new id differs and the planted one dies", async () => {
    const planted = (await newUser()).cookieValue;
    const trip = await browserSignIn(w.t.app, idp, { loginHint: person.oid, cookies: { [COOKIE]: planted } });
    const issued = cookieOf(trip.callback, COOKIE);
    expect(issued).toMatch(/^[\w-]{43}$/);
    expect(issued).not.toBe(planted);
    expect((await me({ cookie: `${COOKIE}=${planted}` })).statusCode).toBe(401);
    expect((await row(planted)).revoked_reason).toBe("rotated");
    expect((await me({ cookie: `${COOKIE}=${issued}` })).statusCode).toBe(200);
  });

  it("a random planted value is ignored and does not stop the sign-in", async () => {
    const trip = await browserSignIn(w.t.app, idp, { loginHint: person.oid, cookies: { [COOKIE]: "Z".repeat(43) } });
    expect(trip.callback.headers.location).toBe("/");
    expect(cookieOf(trip.callback, COOKIE)).not.toBe("Z".repeat(43));
    expect(cookieOf(trip.callback, BINDING_COOKIE_NAME)).toBe("");
  });
});

describe("ending a session", () => {
  it("logout revokes it server side (the old cookie is dead even if the browser keeps it) and clears the cookie", async () => {
    const s = await newUser();
    const res = await apiRequest(w.t, { method: "POST", url: "/v1/auth/logout", as: s });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ redirectTo: string }>().redirectTo).toMatch(/^https?:\/\//);
    const cleared = res.cookies.find((c) => c.name === COOKIE);
    expect(cleared?.value).toBe("");
    expect((await row(s.cookieValue)).revoked_reason).toBe("logout");
    expect((await me(s)).statusCode).toBe(401);
  });

  it("changing a user's role ends all their sessions and nobody else's, the admin's included", async () => {
    const admin = await newUser("admin");
    const [target, other] = [await w.f.makeUser({ role: "staff" }), await newUser()];
    const sessions = [await signIn(w.t, target), await signIn(w.t, target)];
    const res = await apiRequest(w.t, {
      method: "PATCH",
      url: `/v1/users/${target.id}`,
      as: admin,
      body: { role: "kr_admin" },
    });
    expect(res.statusCode).toBe(200);
    for (const s of sessions) {
      expect((await me(s)).statusCode).toBe(401);
      expect((await row(s.cookieValue)).revoked_reason).toBe("role_changed");
    }
    expect((await me(other)).statusCode).toBe(200);
    expect((await me(admin)).statusCode).toBe(200);
  });

  it("disabling a user ends their sessions at once, and enabling them again does not revive any", async () => {
    const admin = await newUser("admin");
    const target = await w.f.makeUser({ role: "external" });
    const s = await signIn(w.t, target);
    await apiRequest(w.t, { method: "PATCH", url: `/v1/users/${target.id}`, as: admin, body: { status: "disabled" } });
    expect((await me(s)).statusCode).toBe(401);
    expect((await row(s.cookieValue)).revoked_reason).toBe("user_disabled");
    await apiRequest(w.t, { method: "PATCH", url: `/v1/users/${target.id}`, as: admin, body: { status: "active" } });
    expect((await me(s)).statusCode).toBe(401);
  });
});

describe("lifetime (idle 120 minutes sliding, absolute 12 hours)", () => {
  const minutes = (n: number) => {
    w.t.clock.advance(n * 60_000);
  };

  it("ends after 120 idle minutes", async () => {
    const s = await newUser();
    minutes(119);
    expect((await me(s)).statusCode).toBe(200);
    minutes(121);
    expect((await me(s)).statusCode).toBe(401);
  });

  it("slides with activity but never past the absolute lifetime", async () => {
    const s = await newUser();
    for (let i = 0; i < 6; i++) {
      minutes(110);
      expect((await me(s)).statusCode, `after ${(i + 1) * 110} minutes`).toBe(200);
    }
    minutes(110);
    expect((await me(s)).statusCode).toBe(401);
    expect((await row(s.cookieValue)).absolute_expires_at.getTime()).toBeLessThan(w.t.clock.now().getTime());
  });

  it("reports the earliest end in /v1/me so the page can warn before it happens", async () => {
    const s = await newUser();
    const body = (await me(s)).json<{ sessionExpiresAt: string }>();
    expect(new Date(body.sessionExpiresAt).getTime() - w.t.clock.now().getTime()).toBe(120 * 60_000);
  });
});
