import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { contractViolations, createTestApp, schemaViolations, type TestApp } from "../../test/helpers/index.js";

describe("health and error responses match packages/contracts/openapi.yaml", () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.close();
  });

  it("getLiveness 200 and getReadiness 200/503", async () => {
    const live = await t.app.inject({ url: "/healthz" });
    expect(contractViolations("getLiveness", live.statusCode, live.json())).toEqual([]);
    const ready = await t.app.inject({ url: "/readyz" });
    expect(contractViolations("getReadiness", ready.statusCode, ready.json())).toEqual([]);
    t.storage.failPing = true;
    const down = await t.app.inject({ url: "/readyz" });
    t.storage.failPing = false;
    expect(down.statusCode).toBe(503);
    expect(contractViolations("getReadiness", 503, down.json())).toEqual([]);
  });

  it("the contract validator rejects a body that does not conform", () => {
    expect(contractViolations("getLiveness", 200, { status: "fine" }).length).toBeGreaterThan(0);
    expect(contractViolations("getLiveness", 418, {}).length).toBeGreaterThan(0);
  });

  it("problem responses (404 and 400) conform to the Problem schema", async () => {
    const notFound = await t.app.inject({ url: "/v1/nope" });
    expect(notFound.headers["content-type"]).toContain("application/problem+json");
    expect(schemaViolations("Problem", notFound.json())).toEqual([]);
    const malformed = await t.app.inject({
      method: "POST",
      url: "/healthz",
      headers: { "content-type": "application/json" },
      payload: "{",
    });
    expect(schemaViolations("Problem", malformed.json())).toEqual([]);
  });
});
