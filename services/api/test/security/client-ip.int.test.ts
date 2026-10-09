/**
 * The per-IP sign-in limit (PRODUCT_SPEC 14: 20 per minute) keys on the address the trusted proxy saw, never on text the
 * client wrote. The BFF forwards X-Forwarded-For as the Railway edge sent it and the API trusts TRUST_PROXY_HOPS hops
 * (ADR-0005). The route under test is the real OIDC callback, which every browser can reach unauthenticated.
 * Known gap, reported in docs/security/findings.md (D-1): the address is not validated, so the rightmost entry is used verbatim.
 */
import { randomInt } from "node:crypto";
import { describe, expect, it } from "vitest";
import { apiRequest, createTestApp, signIn, testConfig, type TestApp } from "../helpers/index.js";
import { createFactories } from "../factories.js";

const LIMIT = 4;
/** An address no other test file uses: the counters live in the one database all files share. */
const fresh = () => `100.${randomInt(64, 128)}.${randomInt(256)}.${randomInt(1, 255)}`;

async function withApp<T>(hops: string, run: (t: TestApp) => Promise<T>): Promise<T> {
  const t = await createTestApp({
    config: testConfig({
      RATE_LIMIT_SIGNIN_PER_MINUTE_PER_IP: String(LIMIT),
      RATE_LIMIT_WRITES_PER_MINUTE: "3",
      TRUST_PROXY_HOPS: hops,
    }),
  });
  try {
    return await run(t);
  } finally {
    await t.close();
  }
}
/** `remote` is the peer the API sees (the BFF in production); each test gets its own so no other test file shares it. */
const callback = (t: TestApp, xff?: string | string[], remote = "10.0.0.1") =>
  t.app.inject({
    url: "/v1/auth/callback",
    remoteAddress: remote,
    headers: xff === undefined ? {} : { "x-forwarded-for": xff },
  });
const statuses = async (t: TestApp, count: number, xff: () => string | string[] | undefined) => {
  const out: number[] = [];
  for (let i = 0; i < count; i++) out.push((await callback(t, xff())).statusCode);
  return out;
};
const ALLOWED = Array<number>(LIMIT).fill(302);

describe("one trusted hop (production: the web BFF)", () => {
  it("counts every request of one real client together, whatever it prefixes to X-Forwarded-For", async () => {
    await withApp("1", async (t) => {
      const real = fresh();
      let n = 0;
      const got = await statuses(t, LIMIT + 3, () => `${randomInt(1, 250)}.${randomInt(256)}.1.${(n += 1)}, ${real}`);
      expect(got).toEqual([...ALLOWED, 429, 429, 429]);
    });
  });

  it("does not let a blocked client escape by adding hops, repeating the header or changing its spelling", async () => {
    await withApp("1", async (t) => {
      const real = fresh();
      expect(await statuses(t, LIMIT, () => real)).toEqual(ALLOWED);
      for (const xff of [real, `9.9.9.9, ${real}`, `${real}, ${real}`.replace(/^[^,]+/, "8.8.8.8"), [`7.7.7.7`, real]])
        expect((await callback(t, xff)).statusCode, JSON.stringify(xff)).toBe(429);
    });
  });

  it("gives another real client its own bucket (one noisy client cannot lock everyone out)", async () => {
    await withApp("1", async (t) => {
      const [a, b] = [fresh(), fresh()];
      expect(await statuses(t, LIMIT + 1, () => a)).toEqual([...ALLOWED, 429]);
      expect(await statuses(t, LIMIT, () => `${a}, ${b}`)).toEqual(ALLOWED);
    });
  });

  it("answers 429 as a problem with Retry-After between 1 and 60 seconds", async () => {
    await withApp("1", async (t) => {
      const real = fresh();
      await statuses(t, LIMIT, () => real);
      const res = await callback(t, real);
      expect(res.statusCode).toBe(429);
      expect(res.json()).toMatchObject({ type: "urn:kr:problem:rate-limited", status: 429 });
      expect(Number(res.headers["retry-after"])).toBeGreaterThanOrEqual(1);
      expect(Number(res.headers["retry-after"])).toBeLessThanOrEqual(60);
    });
  });

  it("does not take the per-user limits from the header: a user's write budget is theirs on every address", async () => {
    await withApp("1", async (t) => {
      const user = await signIn(t, await createFactories(t.db).makeUser());
      const out: number[] = [];
      for (let i = 0; i < 5; i++)
        out.push(
          (await apiRequest(t, { method: "POST", url: "/test/echo", as: user, forwardedFor: fresh() })).statusCode,
        );
      expect(out).toEqual([200, 200, 200, 429, 429]);
    });
  });
});

describe("other proxy depths", () => {
  it("TRUST_PROXY_HOPS=0 ignores X-Forwarded-For entirely: every request counts against the peer address", async () => {
    await withApp("0", async (t) => {
      const remote = fresh();
      const got: number[] = [];
      for (let i = 0; i < LIMIT + 2; i++) got.push((await callback(t, fresh(), remote)).statusCode);
      expect(got).toEqual([...ALLOWED, 429, 429]);
      expect((await callback(t, fresh(), fresh())).statusCode).toBe(302);
    });
  });

  it("TRUST_PROXY_HOPS=2 trusts the second address from the right and nothing further left", async () => {
    await withApp("2", async (t) => {
      const [real, edge] = [fresh(), fresh()];
      let n = 0;
      const got = await statuses(t, LIMIT + 1, () => `${randomInt(1, 250)}.1.1.${(n += 1)}, ${real}, ${edge}`);
      expect(got).toEqual([...ALLOWED, 429]);
    });
  });

  it("falls back to the peer address when the header is absent or empty, and trims spaces around the address", async () => {
    await withApp("1", async (t) => {
      const [remote, real] = [fresh(), fresh()];
      for (const xff of [undefined, ""]) await callback(t, xff, remote);
      await callback(t, ` ${real} `, remote);
      const keys = (await t.db.selectFrom("rate_limits").select("key").where("key", "like", "signIn:%").execute()).map(
        (r) => r.key,
      );
      expect(keys).toEqual(expect.arrayContaining([`signIn:${remote}`, `signIn:${real}`]));
    });
  });
});
