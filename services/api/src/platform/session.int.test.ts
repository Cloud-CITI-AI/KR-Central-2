import fastifyCookie from "@fastify/cookie";
import { createDb, type Db } from "@kr/db";
import Fastify from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inject } from "vitest";
import { createFactories, type Factories } from "../../test/factories.js";
import { testConfig } from "../../test/helpers/config.js";
import { fixedClock } from "./flags.js";
import {
  SESSION_COOKIE,
  clearSessionCookie,
  createSession,
  hashSessionId,
  revokeAllForUser,
  revokeSession,
  sessionPolicy,
  setSessionCookie,
} from "./session.js";

describe("sessions (real Postgres)", () => {
  let db: Db;
  let f: Factories;
  const clock = fixedClock("2026-03-02T01:00:00Z");
  const policy = sessionPolicy({
    clock,
    config: testConfig({ SESSION_IDLE_MINUTES: "120", SESSION_ABSOLUTE_HOURS: "12" }),
  });
  const mfa = { authTime: new Date("2026-03-02T00:59:00Z"), amr: ["pwd", "mfa"], acrs: ["c1"] };

  beforeAll(() => {
    db = createDb({ connectionString: inject("databaseUrl"), applicationName: "kr-api-test" });
    f = createFactories(db);
  });
  afterAll(async () => {
    await db.destroy();
  });

  it("stores only the SHA-256 of a 256-bit cookie value, with its own CSRF token and the MFA evidence", async () => {
    const user = await f.makeUser();
    const s = await createSession(db, { userId: user.id, ...mfa, userAgent: "x".repeat(400) }, policy);
    expect(s.cookieValue).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(s.csrfToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(s.csrfToken).not.toBe(s.cookieValue);
    const row = await db.selectFrom("sessions").selectAll().where("user_id", "=", user.id).executeTakeFirstOrThrow();
    expect(row.id_hash.equals(hashSessionId(s.cookieValue))).toBe(true);
    expect(row.id_hash.toString("utf8")).not.toContain(s.cookieValue);
    expect(row).toMatchObject({ csrf_token: s.csrfToken, amr: ["pwd", "mfa"], acrs: ["c1"], revoked_at: null });
    expect(row.user_agent).toHaveLength(256);
  });

  it("never reuses an id and applies idle 120 min / absolute 12 h from the injected clock", async () => {
    const user = await f.makeUser();
    const [a, b] = [
      await createSession(db, { userId: user.id, ...mfa }, policy),
      await createSession(db, { userId: user.id, ...mfa }, policy),
    ];
    expect(a.cookieValue).not.toBe(b.cookieValue);
    expect(a.idleExpiresAt.toISOString()).toBe("2026-03-02T03:00:00.000Z");
    expect(a.absoluteExpiresAt.toISOString()).toBe("2026-03-02T13:00:00.000Z");
    const short = await createSession(db, { userId: user.id, ...mfa }, { ...policy, idleMinutes: 24 * 60 });
    expect(short.idleExpiresAt.toISOString()).toBe("2026-03-02T13:00:00.000Z");
  });

  it("revokes one session idempotently and records the reason", async () => {
    const user = await f.makeUser();
    const s = await createSession(db, { userId: user.id, ...mfa }, policy);
    await revokeSession(db, hashSessionId(s.cookieValue), "logout", clock);
    clock.advance(1000);
    await revokeSession(db, hashSessionId(s.cookieValue), "admin", clock);
    const row = await db
      .selectFrom("sessions")
      .selectAll()
      .where("id_hash", "=", hashSessionId(s.cookieValue))
      .executeTakeFirstOrThrow();
    expect(row.revoked_reason).toBe("logout");
    expect(row.revoked_at?.toISOString()).toBe("2026-03-02T01:00:00.000Z");
  });

  it("revokes every live session of a user except the caller's own", async () => {
    const user = await f.makeUser();
    const other = await f.makeUser();
    const [keep, drop1, drop2] = await Promise.all(
      [1, 2, 3].map(() => createSession(db, { userId: user.id, ...mfa }, policy)),
    );
    const bystander = await createSession(db, { userId: other.id, ...mfa }, policy);
    const n = await revokeAllForUser(db, user.id, "role_changed", clock, hashSessionId(keep!.cookieValue));
    expect(n).toBe(2);
    const live = await db
      .selectFrom("sessions")
      .select("id_hash")
      .where("revoked_at", "is", null)
      .where("user_id", "in", [user.id, other.id])
      .execute();
    expect(live.map((r) => r.id_hash.toString("hex")).sort()).toEqual(
      [keep, bystander].map((s) => hashSessionId(s!.cookieValue).toString("hex")).sort(),
    );
    expect(drop1).toBeDefined();
    expect(drop2).toBeDefined();
  });
});

describe("session cookie", () => {
  it("is __Host- prefixed, HttpOnly, Secure, SameSite=Lax, Path=/ with no Domain, and clearable", async () => {
    const app = Fastify();
    await app.register(fastifyCookie);
    app.get("/set", (_req, reply) => {
      setSessionCookie(reply, "v".repeat(43));
      return reply.send({});
    });
    app.get("/clear", (_req, reply) => {
      clearSessionCookie(reply);
      return reply.send({});
    });
    const set = String((await app.inject({ url: "/set" })).headers["set-cookie"]);
    expect(set).toBe(`${SESSION_COOKIE}=${"v".repeat(43)}; Path=/; HttpOnly; Secure; SameSite=Lax`);
    expect(SESSION_COOKIE.startsWith("__Host-")).toBe(true);
    const cleared = String((await app.inject({ url: "/clear" })).headers["set-cookie"]);
    expect(cleared).toMatch(/^__Host-kr_session=; Max-Age=0; Path=\/; Expires=Thu, 01 Jan 1970/);
    expect(cleared).toMatch(/HttpOnly; Secure; SameSite=Lax/);
    await app.close();
  });
});
