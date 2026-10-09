import { readFileSync } from "node:fs";
import { parseConfig } from "@kr/config";
import { ROUTES } from "@kr/contracts";
import { describe, expect, it } from "vitest";
import { createTestApp, dummyDb } from "../test/helpers/index.js";
import { registeredOperations, requestIdFor, unregisteredOperations } from "./app.js";
import { ApiConfigSchema } from "./config.js";
import { MODULES } from "./modules/index.js";
import type { ApiModule } from "./platform/module.js";
import { defineRoute } from "./platform/routes.js";

describe("route table", () => {
  it("registers only operations declared in the contract, health included", async () => {
    const t = await createTestApp({ db: dummyDb() });
    const declared = new Set<string>(ROUTES.map((r) => r.operationId));
    for (const id of registeredOperations(t.app)) expect(declared.has(id), id).toBe(true);
    expect(registeredOperations(t.app)).toContain("getLiveness");
    expect(registeredOperations(t.app)).toContain("getReadiness");
    await t.close();
  });

  it("leaves unregistered only operations that a module owns (WP-20 makes the list empty)", async () => {
    const t = await createTestApp({ db: dummyDb() });
    const owned = new Set<string>(MODULES.flatMap((m) => m.operations));
    for (const id of unregisteredOperations(t.app)) expect(owned.has(id), id).toBe(true);
    await t.close();
  });
});

describe("platform behaviour", () => {
  it("answers unknown paths with a problem+json 404 that carries the request id", async () => {
    const t = await createTestApp({ db: dummyDb() });
    const res = await t.app.inject({ url: "/v1/nope?x=1" });
    expect(res.statusCode).toBe(404);
    expect(res.headers["content-type"]).toContain("application/problem+json");
    expect(res.json()).toMatchObject({
      type: "urn:kr:problem:not-found",
      instance: "/v1/nope",
      requestId: res.headers["x-request-id"],
    });
    await t.close();
  });

  it("accepts JSON bodies only: text/plain is 415, not a validation error", async () => {
    const mod: ApiModule = {
      name: "test",
      operations: [],
      register: (app) => {
        defineRoute(app, "createNote", () => Promise.reject(new Error("unreachable")));
      },
    };
    const t = await createTestApp({ db: dummyDb(), extraModules: [mod] });
    const res = await t.app.inject({
      method: "POST",
      url: "/v1/jobs/0f8fad5b-d9cb-469f-a165-70867728950e/notes",
      headers: { "content-type": "text/plain" },
      payload: "x",
    });
    expect(res.statusCode).toBe(415);
    await t.close();
  });
});

describe("request ids", () => {
  it("reuses a well-formed inbound X-Request-ID and replaces a malformed one", async () => {
    const t = await createTestApp({ db: dummyDb() });
    const ok = await t.app.inject({ url: "/healthz", headers: { "x-request-id": "bff-1234.abcd_EF" } });
    expect(ok.headers["x-request-id"]).toBe("bff-1234.abcd_EF");
    const bad = await t.app.inject({ url: "/healthz", headers: { "x-request-id": "x y\r\nSet-Cookie: a" } });
    expect(bad.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
    expect(requestIdFor({ headers: {} })).toMatch(/^[0-9a-f-]{36}$/);
    await t.close();
  });

  it("logs one request_completed line per request without the query string", async () => {
    const t = await createTestApp({ db: dummyDb() });
    await t.app.inject({ url: "/healthz?code=abc&state=def" });
    const line = t.logLines().find((l) => l.event === "request_completed");
    expect(line).toMatchObject({ method: "GET", route: "/healthz", status: 200, service: "api-test" });
    expect(typeof line?.requestId).toBe("string");
    expect(JSON.stringify(t.logLines())).not.toContain("abc");
    await t.close();
  });
});

describe(".env.example parity (CF-3)", () => {
  const text = readFileSync(new URL("../../../.env.example", import.meta.url), "utf8");
  const example = new Map<string, string>();
  for (const line of text.split("\n")) {
    const m = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
    if (m?.[1]) example.set(m[1], (m[2] ?? "").split(/\s+#/)[0]?.trim() ?? "");
  }

  it("lists every ApiConfigSchema key", () => {
    const missing = Object.keys(ApiConfigSchema.shape).filter((k) => !example.has(k));
    expect(missing).toEqual([]);
  });

  it("holds values the schema accepts (blank means unset)", () => {
    const env = Object.fromEntries([...example].filter(([k, v]) => v !== "" && k in ApiConfigSchema.shape));
    expect(() => parseConfig(ApiConfigSchema, env)).not.toThrow();
  });
});
