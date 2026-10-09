import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFactories, type Factories } from "../../test/factories.js";
import {
  apiRequest,
  createTestApp,
  signIn,
  testConfig,
  type SignedIn,
  type TestApp,
} from "../../test/helpers/index.js";
import { markAuthzChecked } from "./auth-context.js";
import type { ApiModule } from "./module.js";
import { defineRoute } from "./routes.js";

const JOB = "0f8fad5b-d9cb-469f-a165-70867728950e";

/** Contract routes that exercise each limiter: a public auth route, and a multipart upload route. */
const routes: ApiModule = {
  name: "rate-limit-test",
  operations: [],
  register(app) {
    app.addContentTypeParser("multipart/form-data", (_req, _payload, done) => {
      done(null, undefined);
    });
    defineRoute(app, "startLogin", async ({ reply }) => reply.header("location", "/idp").send());
    defineRoute(app, "uploadFile", async ({ auth, reply }) => {
      markAuthzChecked(auth);
      return reply.code(204).send();
    });
  },
};

describe("rate limits (real Postgres, low limits)", () => {
  let t: TestApp;
  let f: Factories;
  beforeAll(async () => {
    const config = testConfig({
      RATE_LIMIT_SIGNIN_PER_MINUTE_PER_IP: "3",
      RATE_LIMIT_WRITES_PER_MINUTE: "4",
      RATE_LIMIT_UPLOADS_PER_MINUTE: "2",
      RATE_LIMIT_READS_PER_MINUTE: "5",
      TRUST_PROXY_HOPS: "1",
    });
    t = await createTestApp({ config, modules: [routes] });
    f = createFactories(t.db);
  });
  afterAll(async () => {
    await t.close();
  });
  const user = async () => signIn(t, await f.makeUser());
  const login = (forwardedFor: string) => apiRequest(t, { url: "/v1/auth/login", forwardedFor });
  const echo = (as: SignedIn) => apiRequest(t, { method: "POST", url: "/test/echo", as });
  const read = (as: SignedIn) => apiRequest(t, { url: "/test/whoami", as });
  const upload = (as: SignedIn) =>
    t.app.inject({
      method: "POST",
      url: `/v1/jobs/${JOB}/files`,
      headers: {
        cookie: as.cookie,
        "x-csrf-token": as.csrf,
        origin: "https://tracker.test",
        "content-type": "multipart/form-data; boundary=x",
      },
      payload: "--x--",
    });

  it("sign-in: 3 per minute per client IP, then 429 with Retry-After", async () => {
    for (let i = 0; i < 3; i++)
      expect(
        (await login("198.51.100.10")).statusCode,
        JSON.stringify(t.logLines().filter((l) => l.level === "error")),
      ).toBe(302);
    const blocked = await login("198.51.100.10");
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json()).toMatchObject({ type: "urn:kr:problem:rate-limited", status: 429 });
    const retry = Number(blocked.headers["retry-after"]);
    expect(retry).toBeGreaterThanOrEqual(1);
    expect(retry).toBeLessThanOrEqual(60);
  });

  it("sign-in keys on the forwarded client IP, not the BFF's address: two clients get separate buckets", async () => {
    for (let i = 0; i < 3; i++) expect((await login("198.51.100.20")).statusCode).toBe(302);
    expect((await login("198.51.100.20")).statusCode).toBe(429);
    for (let i = 0; i < 3; i++) expect((await login("198.51.100.21")).statusCode).toBe(302);
    expect((await login("198.51.100.21")).statusCode).toBe(429);
  });

  it("an attacker-supplied left part of X-Forwarded-For cannot mint new buckets (one trusted hop)", async () => {
    for (let i = 0; i < 3; i++) expect((await login(`10.0.0.${i}, 198.51.100.30`)).statusCode).toBe(302);
    expect((await login("10.9.9.9, 198.51.100.30")).statusCode).toBe(429);
  });

  it("writes: 4 per minute per user; reads are a separate bucket; other users are unaffected", async () => {
    const [a, b] = [await user(), await user()];
    for (let i = 0; i < 4; i++) expect((await echo(a)).statusCode).toBe(200);
    const blocked = await echo(a);
    expect(blocked.statusCode).toBe(429);
    expect(blocked.headers["retry-after"]).toBeDefined();
    expect((await read(a)).statusCode).toBe(200);
    expect((await echo(b)).statusCode).toBe(200);
  });

  it("reads: 5 per minute per user", async () => {
    const a = await user();
    for (let i = 0; i < 5; i++) expect((await read(a)).statusCode).toBe(200);
    expect((await read(a)).statusCode).toBe(429);
  });

  it("uploads: 2 per minute per user, charged to their own bucket and not to writes", async () => {
    const a = await user();
    expect((await upload(a)).statusCode).toBe(204);
    expect((await upload(a)).statusCode).toBe(204);
    expect((await upload(a)).statusCode).toBe(429);
    expect((await echo(a)).statusCode).toBe(200);
  });

  it("health probes are exempt and counters live in the rate_limits table", async () => {
    for (let i = 0; i < 20; i++) expect((await t.app.inject({ url: "/healthz" })).statusCode).toBe(200);
    const rows = await t.db.selectFrom("rate_limits").select("key").where("key", "like", "signIn:%").execute();
    expect(rows.map((r) => r.key)).toEqual(expect.arrayContaining(["signIn:198.51.100.10", "signIn:198.51.100.30"]));
  });
});
