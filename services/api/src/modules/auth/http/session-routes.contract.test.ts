import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFactories } from "../../../../test/factories.js";
import {
  apiRequest,
  contractViolations,
  createTestApp,
  signIn,
  testConfig,
  type TestApp,
} from "../../../../test/helpers/index.js";

describe("auth and session responses match openapi.yaml", () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp({ config: testConfig({ ENTRA_AUTHORITY_HOST: "http://127.0.0.1:1" }) });
  });
  afterAll(async () => {
    await t.close();
  });

  it("getMe 200 and 401, logout 200", async () => {
    const f = createFactories(t.db);
    const me = await signIn(t, await f.makeUser({ role: "kr_admin" }));
    const ok = await apiRequest(t, { url: "/v1/me", as: me });
    expect(contractViolations("getMe", 200, ok.json())).toEqual([]);
    const denied = await apiRequest(t, { url: "/v1/me" });
    expect(contractViolations("getMe", 401, denied.json(), "application/problem+json")).toEqual([]);
    const out = await apiRequest(t, { method: "POST", url: "/v1/auth/logout", as: me });
    expect(contractViolations("logout", 200, out.json())).toEqual([]);
  });

  it("startLogin 400 is a problem document", async () => {
    const res = await t.app.inject({ url: "/v1/auth/login?returnTo=%2F%2Fevil.test" });
    expect(res.statusCode).toBe(400);
    expect(contractViolations("startLogin", 400, res.json(), "application/problem+json")).toEqual([]);
  });
});
