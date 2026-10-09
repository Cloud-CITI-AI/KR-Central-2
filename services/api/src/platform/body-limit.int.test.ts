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

const json = (bytes: number) => ({ pad: "x".repeat(bytes - '{"pad":""}'.length) });

describe("JSON body limit (real Postgres)", () => {
  let t: TestApp;
  let me: SignedIn;
  let f: Factories;
  beforeAll(async () => {
    t = await createTestApp({ config: testConfig({ JSON_BODY_LIMIT_BYTES: "2048" }) });
    f = createFactories(t.db);
    me = await signIn(t, await f.makeUser());
  });
  afterAll(async () => {
    await t.close();
  });
  const post = (body: unknown) => apiRequest(t, { method: "POST", url: "/test/echo", as: me, body });

  it("accepts a body at the configured limit and answers 413 problem+json above it", async () => {
    expect((await post(json(2048))).statusCode).toBe(200);
    const res = await post(json(2049));
    expect(res.statusCode).toBe(413);
    expect(res.headers["content-type"]).toContain("application/problem+json");
    expect(res.json()).toMatchObject({ type: "urn:kr:problem:payload-too-large", status: 413 });
  });

  it("the limit comes from JSON_BODY_LIMIT_BYTES, defaulting to the spec's 100 KB", async () => {
    const def = await createTestApp({ config: testConfig() });
    const user = await signIn(def, await f.makeUser());
    const send = (n: number) => apiRequest(def, { method: "POST", url: "/test/echo", as: user, body: json(n) });
    expect((await send(100 * 1024)).statusCode).toBe(200);
    expect((await send(100 * 1024 + 1)).statusCode).toBe(413);
    await def.close();
  });
});
