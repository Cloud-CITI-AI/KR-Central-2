import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFactories } from "../../test/factories.js";
import {
  apiRequest,
  createTestApp,
  schemaViolations,
  signIn,
  testConfig,
  type SignedIn,
  type TestApp,
} from "../../test/helpers/index.js";

/** Every problem the platform itself produces (before any module code) conforms to the contract's Problem schema. */
describe("platform problem responses match the Problem schema in openapi.yaml", () => {
  let t: TestApp;
  let me: SignedIn;
  beforeAll(async () => {
    t = await createTestApp({ config: testConfig({ RATE_LIMIT_READS_PER_MINUTE: "3" }) });
    me = await signIn(t, await createFactories(t.db).makeUser());
  });
  afterAll(async () => {
    await t.close();
  });

  const cases: [
    string,
    number,
    () => Promise<{ statusCode: number; headers: Record<string, unknown>; json: () => unknown }>,
  ][] = [
    ["401 no session", 401, () => t.app.inject({ url: "/test/whoami" })],
    ["403 CSRF", 403, () => apiRequest(t, { method: "POST", url: "/test/echo", as: me, csrf: null })],
    ["404 unknown path", 404, () => apiRequest(t, { url: "/v1/nope", as: me })],
    [
      "413 body too large",
      413,
      () => apiRequest(t, { method: "POST", url: "/test/echo", as: me, body: { pad: "x".repeat(200_000) } }),
    ],
    [
      "415 media type",
      415,
      () =>
        apiRequest(t, {
          method: "POST",
          url: "/test/echo",
          as: me,
          headers: { "content-type": "text/plain" },
          body: "x",
        }),
    ],
    ["414 path parameter too long", 414, () => t.app.inject({ url: `/v1/jobs/${"a".repeat(600)}` })],
    ["400 malformed percent-encoding in the path", 400, () => t.app.inject({ url: "/v1/jobs/%E0%A4%A" })],
    ["429 rate limited", 429, () => apiRequest(t, { url: "/test/whoami", as: me })],
  ];

  it.each(cases)("%s", async (_name, status, send) => {
    if (status === 429) for (let i = 0; i < 3; i++) await apiRequest(t, { url: "/test/whoami", as: me });
    const res = await send();
    expect(res.statusCode).toBe(status);
    expect(String(res.headers["content-type"])).toContain("application/problem+json");
    expect(schemaViolations("Problem", res.json())).toEqual([]);
  });
});
