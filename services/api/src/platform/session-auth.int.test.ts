import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFactories, type Factories } from "../../test/factories.js";
import { createTestApp, signIn, testConfig, type SignedIn, type TestApp } from "../../test/helpers/index.js";
import { SESSION_COOKIE, hashSessionId, revokeAllForUser, revokeSession } from "./session.js";

const IDLE_MIN = 30;

describe("session authentication hook (real Postgres)", () => {
  let t: TestApp;
  let f: Factories;
  beforeAll(async () => {
    t = await createTestApp({
      config: testConfig({ SESSION_IDLE_MINUTES: String(IDLE_MIN), SESSION_ABSOLUTE_HOURS: "2" }),
    });
    f = createFactories(t.db);
  });
  afterAll(async () => {
    await t.close();
  });

  const whoami = (cookie?: string) => t.app.inject({ url: "/test/whoami", ...(cookie ? { headers: { cookie } } : {}) });
  const lastSeen = async (s: SignedIn) =>
    (
      await t.db
        .selectFrom("sessions")
        .select("last_seen_at")
        .where("id_hash", "=", hashSessionId(s.cookieValue))
        .executeTakeFirstOrThrow()
    ).last_seen_at;

  it("a valid cookie authenticates and attaches the user and its capabilities", async () => {
    const s = await signIn(t, await f.makeUser({ role: "kr_admin" }));
    const res = await whoami(s.cookie);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ userId: s.user.id, role: "kr_admin" });
  });

  it("no cookie, a malformed cookie and an unknown cookie are all 401 problems", async () => {
    for (const cookie of [
      undefined,
      `${SESSION_COOKIE}=short`,
      `${SESSION_COOKIE}=${"A".repeat(43)}`,
      `${SESSION_COOKIE}=${"%".repeat(43)}`,
    ]) {
      const res = await whoami(cookie);
      expect(res.statusCode).toBe(401);
      expect(res.json()).toMatchObject({ type: "urn:kr:problem:unauthenticated" });
    }
  });

  it("public routes work without a session", async () => {
    expect((await t.app.inject({ url: "/healthz" })).statusCode).toBe(200);
  });

  it("idle expiry: 401 once the idle window has passed without activity", async () => {
    const s = await signIn(t, await f.makeUser());
    t.clock.advance((IDLE_MIN - 1) * 60_000);
    expect((await whoami(s.cookie)).statusCode).toBe(200);
    t.clock.advance((IDLE_MIN + 1) * 60_000);
    expect((await whoami(s.cookie)).statusCode).toBe(401);
  });

  it("absolute expiry: activity keeps the session alive until the absolute limit, then 401", async () => {
    const s = await signIn(t, await f.makeUser());
    for (let i = 0; i < 4; i++) {
      t.clock.advance(25 * 60_000);
      expect((await whoami(s.cookie)).statusCode).toBe(200);
    }
    t.clock.advance(19 * 60_000);
    expect((await whoami(s.cookie)).statusCode).toBe(200);
    t.clock.advance(2 * 60_000);
    expect((await whoami(s.cookie)).statusCode).toBe(401);
  });

  it("a revoked session, a revoke-all and a disabled user are 401", async () => {
    const a = await signIn(t, await f.makeUser());
    await revokeSession(t.db, hashSessionId(a.cookieValue), "logout", t.deps.clock);
    expect((await whoami(a.cookie)).statusCode).toBe(401);

    const b = await signIn(t, await f.makeUser());
    await revokeAllForUser(t.db, b.user.id, "role_changed", t.deps.clock);
    expect((await whoami(b.cookie)).statusCode).toBe(401);

    const c = await signIn(t, await f.makeUser());
    await t.db.updateTable("users").set({ status: "disabled" }).where("id", "=", c.user.id).execute();
    expect((await whoami(c.cookie)).statusCode).toBe(401);
  });

  it("last_seen_at slides at most once a minute", async () => {
    const s = await signIn(t, await f.makeUser());
    const created = await lastSeen(s);
    t.clock.advance(59_000);
    await whoami(s.cookie);
    expect((await lastSeen(s)).getTime()).toBe(created.getTime());
    t.clock.advance(2_000);
    await whoami(s.cookie);
    const slid = await lastSeen(s);
    expect(slid.getTime()).toBe(t.deps.clock.now().getTime());
    t.clock.advance(30_000);
    await whoami(s.cookie);
    expect((await lastSeen(s)).getTime()).toBe(slid.getTime());
  });
});
