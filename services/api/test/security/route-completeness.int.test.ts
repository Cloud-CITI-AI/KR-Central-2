import { PROBLEM_TYPES, ROUTES, PUBLIC_PATHS, toFastifyPath } from "@kr/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { registeredOperations, unregisteredOperations } from "../../src/app.js";
import { SESSION_COOKIE, hashSessionId } from "../../src/platform/session.js";
import { apiRequest, signIn, TEST_ORIGIN } from "../helpers/index.js";
import { createWorld, urlFor, type World } from "./support.js";

const SESSION_ROUTES = ROUTES.filter((r) => r.auth === "session");
const WRITES = SESSION_ROUTES.filter((r) => r.method !== "GET");
/** The only routes outside the contract: the test probes of test/helpers/probe.ts. */
const PROBES = ["GET /test/whoami", "POST /test/echo", "PUT /test/echo", "PATCH /test/echo", "DELETE /test/echo"];

/** "METHOD /full/path" for every route Fastify holds, read from its radix tree (HEAD twins of GET are ignored). */
function registeredRoutes(world: World): string[] {
  const out: string[] = [];
  const parents: string[] = [];
  for (const line of world.t.app.printRoutes({ commonPrefix: false }).split("\n")) {
    const at = line.search(/[├└]/);
    if (at < 0) continue;
    const rest = line.slice(at + 4);
    const open = rest.lastIndexOf(" (");
    parents.length = at / 4;
    parents[at / 4] = rest.slice(0, open);
    const path = parents.join("");
    for (const method of rest.slice(open + 2, -1).split(", ")) if (method !== "HEAD") out.push(`${method} ${path}`);
  }
  return out.sort();
}

let w: World;
beforeAll(async () => {
  w = await createWorld();
});
afterAll(async () => {
  await w.t.close();
});

describe("route completeness (every contract operation, nothing else)", () => {
  it("registers exactly the operations in ROUTES: none missing, none extra, none twice", () => {
    const declared = ROUTES.map((r) => r.operationId);
    expect(new Set(declared).size).toBe(declared.length);
    expect([...registeredOperations(w.t.app)].sort()).toEqual([...declared].sort());
    expect(unregisteredOperations(w.t.app)).toEqual([]);
  });

  it("holds no route besides the contract's and the test probes (no undeclared endpoint)", () => {
    const declared = ROUTES.map((r) => `${r.method} ${toFastifyPath(r.path)}`);
    expect(new Set(declared).size).toBe(declared.length);
    expect(registeredRoutes(w)).toEqual([...declared, ...PROBES].sort());
  });

  it("marks only health probes and the two OIDC redirects public, and all of them GET", () => {
    expect([...PUBLIC_PATHS].sort()).toEqual(["/healthz", "/readyz", "/v1/auth/callback", "/v1/auth/login"]);
    expect(new Set(ROUTES.filter((r) => r.auth === "public").map((r) => r.method))).toEqual(new Set(["GET"]));
  });

  it("describes the authorisation rule of every operation", () => {
    for (const r of ROUTES) expect(r.authz.trim().length, r.operationId).toBeGreaterThan(5);
  });
});

describe("authentication: every non-public route answers 401 without a valid session", () => {
  /** A signed-in admin whose session was then ended the given way. */
  const ended = async (how: "revoked" | "idle" | "absolute") => {
    const user = await w.f.makeUser({ role: "admin" });
    const signed = await signIn(w.t, user);
    const past = new Date(w.t.clock.now().getTime() - 1000);
    const patch = {
      revoked: { revoked_at: past, revoked_reason: "logout" as const },
      idle: { idle_expires_at: past },
      absolute: { absolute_expires_at: past },
    }[how];
    await w.t.db.updateTable("sessions").set(patch).where("id_hash", "=", hashSessionId(signed.cookieValue)).execute();
    return signed.cookie;
  };

  const send = (method: string, url: string, cookie?: string) =>
    w.t.app.inject({
      method: method as "GET",
      url,
      headers: { origin: TEST_ORIGIN, ...(cookie ? { cookie } : {}) },
      ...(method === "GET" || method === "HEAD" ? {} : { payload: {} }),
    });
  const expect401 = (res: Awaited<ReturnType<typeof send>>, label: string) => {
    expect(res.statusCode, label).toBe(401);
    if (res.statusCode === 401 && res.body) {
      expect(res.headers["content-type"], label).toContain("application/problem+json");
      expect(res.json<{ type: string }>().type, label).toBe(PROBLEM_TYPES.unauthenticated);
    }
  };

  it.each(SESSION_ROUTES.map((r) => [r.operationId, r] as const))("%s without a cookie", async (_id, route) => {
    expect401(await send(route.method, urlFor(route)), route.operationId);
  });

  it("refuses every kind of bad cookie on every non-public route", async () => {
    const bad = [
      `${SESSION_COOKIE}=`,
      `${SESSION_COOKIE}=short`,
      `${SESSION_COOKIE}=${"A".repeat(43)}`,
      `${SESSION_COOKIE}=${"A".repeat(44)}`,
      `${SESSION_COOKIE}='; DROP TABLE sessions;--`,
      `kr_session=${w.actors.admin.cookieValue}`,
      // Last character changed; it must differ from the real one (a 1-in-16 chance otherwise: 32 random bytes in
      // base64url end in one of 16 characters, `A` among them).
      `${SESSION_COOKIE}=${w.actors.admin.cookieValue.slice(0, -1)}${w.actors.admin.cookieValue.endsWith("A") ? "E" : "A"}`,
      `__Secure-kr_session=${w.actors.admin.cookieValue}`,
      await ended("revoked"),
      await ended("idle"),
      await ended("absolute"),
      w.actors.disabled.cookie,
    ];
    for (const cookie of bad)
      for (const route of SESSION_ROUTES) expect401(await send(route.method, urlFor(route), cookie), cookie);
  });

  it("does not accept the session id anywhere but the cookie (header, query string, bearer token)", async () => {
    const id = w.actors.admin.cookieValue;
    const attempts = [
      { url: "/v1/me", headers: { authorization: `Bearer ${id}` } },
      { url: "/v1/me", headers: { "x-session-id": id } },
      { url: `/v1/me?${SESSION_COOKIE}=${id}`, headers: {} },
    ];
    for (const a of attempts) expect401(await w.t.app.inject({ method: "GET", ...a }), a.url);
  });

  it("answers 401, not 404, for paths that do not exist, so routes cannot be enumerated", async () => {
    for (const url of ["/nope", "/v1", "/v1/jobs/../users", "/v1/admin", "/test/echo/x", "/.env", "/v1/jobs//"])
      for (const method of ["GET", "POST", "DELETE"]) expect401(await send(method, url), `${method} ${url}`);
  });

  it("answers HEAD on a session route with 401 as well", async () => {
    for (const r of SESSION_ROUTES.filter((x) => x.method === "GET"))
      expect(await send("HEAD", urlFor(r))).toMatchObject({ statusCode: 401 });
  });

  it("lets a valid session through to the handler (the 401 above is about the cookie, not the route)", async () => {
    const res = await apiRequest(w.t, { url: "/v1/me", as: w.actors.staff });
    expect(res.statusCode).toBe(200);
  });
});

describe("CSRF: every state-changing route answers 403 without the session's token and the public Origin", () => {
  const call = (route: (typeof WRITES)[number], o: { csrf?: string | null; origin?: string | null }) =>
    apiRequest(w.t, {
      method: route.method,
      url: urlFor(route),
      as: w.actors.admin,
      body: {},
      ...o,
    });

  it.each(WRITES.map((r) => [r.operationId, r] as const))("%s", async (_id, route) => {
    const variants = [
      { csrf: null },
      { csrf: "" },
      { csrf: w.actors.staff.csrf },
      { csrf: "x".repeat(43) },
      { origin: null },
      { origin: "https://evil.example" },
      { origin: `${TEST_ORIGIN}.evil.example` },
      { origin: "null" },
      { csrf: null, origin: null },
    ];
    for (const v of variants) {
      const res = await call(route, v);
      expect(res.statusCode, `${route.operationId} ${JSON.stringify(v)}`).toBe(403);
      expect(res.json<{ type: string }>().type).toBe(PROBLEM_TYPES.forbidden);
    }
  });

  it("a rejected write changes nothing (the check runs before the handler)", async () => {
    const job = await w.f.makeJob();
    const before = await w.t.db
      .selectFrom("audit_events")
      .select(w.t.db.fn.countAll().as("n"))
      .executeTakeFirstOrThrow();
    const res = await apiRequest(w.t, {
      method: "DELETE",
      url: `/v1/jobs/${job.id}`,
      as: w.actors.admin,
      csrf: null,
      headers: { "if-match": '"1"' },
    });
    expect(res.statusCode).toBe(403);
    const after = await w.t.db
      .selectFrom("audit_events")
      .select(w.t.db.fn.countAll().as("n"))
      .executeTakeFirstOrThrow();
    expect(after.n).toBe(before.n);
    expect(
      (await w.t.db.selectFrom("jobs").select("deleted_at").where("id", "=", job.id).executeTakeFirstOrThrow())
        .deleted_at,
    ).toBeNull();
  });

  it("applies to every non-safe method, not only to the ones the contract uses", async () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"] as const) {
      const res = await apiRequest(w.t, { method, url: "/test/echo", as: w.actors.admin, csrf: null });
      expect(res.statusCode, method).toBe(403);
    }
  });

  it("is not needed for safe methods, which change no state", async () => {
    for (const r of SESSION_ROUTES.filter((x) => x.method === "GET" && !x.path.includes("{")))
      expect((await apiRequest(w.t, { url: r.path, as: w.actors.admin })).statusCode, r.operationId).toBe(200);
  });
});
