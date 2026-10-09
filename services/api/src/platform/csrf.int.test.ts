import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFactories } from "../../test/factories.js";
import {
  apiRequest,
  createTestApp,
  signIn,
  TEST_ORIGIN,
  type SignedIn,
  type TestApp,
} from "../../test/helpers/index.js";
import { safeEqual } from "./csrf.js";

describe("CSRF and Origin checks (real Postgres)", () => {
  let t: TestApp;
  let me: SignedIn;
  let other: SignedIn;
  beforeAll(async () => {
    t = await createTestApp();
    const f = createFactories(t.db);
    [me, other] = [await signIn(t, await f.makeUser()), await signIn(t, await f.makeUser())];
  });
  afterAll(async () => {
    await t.close();
  });
  const post = (
    o: { csrf?: string | null; origin?: string | null; method?: "POST" | "PUT" | "PATCH" | "DELETE" } = {},
  ) =>
    apiRequest(t, {
      method: o.method ?? "POST",
      url: "/test/echo",
      as: me,
      ...("csrf" in o ? { csrf: o.csrf } : {}),
      ...("origin" in o ? { origin: o.origin } : {}),
    });

  it("passes with the session's token and the public origin, for every state-changing method", async () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"] as const) {
      const res = await post({ method });
      expect(res.statusCode, method).toBe(200);
      expect(res.json()).toEqual({ ok: true, userId: me.user.id });
    }
  });

  it("is 403 without a token, with a wrong token and with another session's token", async () => {
    for (const csrf of [null, "", "x".repeat(43), other.csrf]) {
      const res = await post({ csrf });
      expect(res.statusCode, String(csrf)).toBe(403);
      expect(res.json()).toMatchObject({ type: "urn:kr:problem:forbidden" });
      expect(res.body).not.toContain(me.csrf);
    }
  });

  it("is 403 without an Origin and with a foreign, look-alike or differently-schemed Origin", async () => {
    const lookalikes = [
      null,
      "https://evil.example",
      `${TEST_ORIGIN}.evil.example`,
      `${TEST_ORIGIN}/`,
      "http://tracker.test",
      "https://tracker.test:8443",
      "null",
    ];
    for (const origin of lookalikes) {
      expect((await post({ origin })).statusCode, String(origin)).toBe(403);
    }
  });

  it("does not apply to safe methods", async () => {
    expect((await apiRequest(t, { url: "/test/whoami", as: me })).statusCode).toBe(200);
  });

  it("answers 401 (not 403) when there is no session at all, before any CSRF logic", async () => {
    const res = await t.app.inject({ method: "POST", url: "/test/echo", headers: { origin: TEST_ORIGIN } });
    expect(res.statusCode).toBe(401);
  });
});

describe("safeEqual", () => {
  it("compares strings of any length without throwing", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
    expect(safeEqual("", "")).toBe(true);
  });
});
