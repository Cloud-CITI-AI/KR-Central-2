import { readFileSync } from "node:fs";
import { parseConfig } from "@kr/config";
import { ROUTES } from "@kr/contracts";
import { describe, expect, it, vi } from "vitest";
import { createTestApp, dummyDb } from "../test/helpers/index.js";
import { registeredOperations, requestIdFor, trustHops, unregisteredOperations } from "./app.js";
import { ApiConfigSchema } from "./config.js";
import { MODULES } from "./modules/index.js";

const UUID = "0f8fad5b-d9cb-469f-a165-70867728950e";

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
  it("denies by default: only the public routes answer without a session, even unknown paths are 401", async () => {
    const t = await createTestApp({ db: dummyDb() });
    for (const [method, url] of [
      ["GET", "/v1/nope"],
      ["POST", "/healthz"],
      ["GET", "/v1/jobs"],
      ["GET", "/test/whoami"],
    ] as const) {
      const res = await t.app.inject({ method, url });
      expect(res.statusCode, `${method} ${url}`).toBe(401);
      expect(res.json()).toMatchObject({ type: "urn:kr:problem:unauthenticated", status: 401 });
    }
    await t.close();
  });
});

describe("module registration", () => {
  it("buildApp registers every module in MODULES", async () => {
    const spies = MODULES.map((m) => vi.spyOn(m, "register"));
    const t = await createTestApp({ db: dummyDb() });
    for (const spy of spies) expect(spy).toHaveBeenCalledTimes(1);
    vi.restoreAllMocks();
    await t.close();
  });

  it("every contract route that needs a session answers 401 without one (route-table check)", async () => {
    const t = await createTestApp({ db: dummyDb() });
    for (const r of ROUTES.filter((x) => x.auth === "session")) {
      const url = r.path.replaceAll(/\{(\w+)\}/g, (_, name: string) => (name === "checkpointKey" ? "i1_0p" : UUID));
      const res = await t.app.inject({ method: r.method, url });
      expect(res.statusCode, `${r.operationId} ${r.method} ${url}`).toBe(401);
    }
    await t.close();
  });
});

describe("trustHops", () => {
  it("trusts the N nearest hops (proxy-addr semantics) and nobody for 0", () => {
    expect(trustHops(0)).toBe(false);
    const one = trustHops(1) as (address: string, hop: number) => boolean;
    expect([one("10.0.0.1", 0), one("203.0.113.5", 1)]).toEqual([true, false]);
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
