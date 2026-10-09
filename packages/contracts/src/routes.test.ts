import { describe, expect, it } from "vitest";
import { PUBLIC_PATHS, ROUTES, buildPath, toFastifyPath, type RouteDef } from "./routes.js";

const routes = ROUTES as readonly RouteDef[];

describe("route registry", () => {
  it("has unique operation ids and unique method+path pairs", () => {
    expect(new Set(routes.map((r) => r.operationId)).size).toBe(routes.length);
    expect(new Set(routes.map((r) => `${r.method} ${r.path}`)).size).toBe(routes.length);
  });

  it("keeps the public allowlist to health and the OIDC endpoints (API-6)", () => {
    expect([...PUBLIC_PATHS].sort()).toEqual(["/healthz", "/readyz", "/v1/auth/callback", "/v1/auth/login"]);
  });

  it("requires a CSRF header on every state-changing session route", () => {
    for (const r of routes.filter((x) => x.auth === "session" && x.method !== "GET")) {
      const headers = r.request?.headers;
      expect(headers, r.operationId).toBeDefined();
      expect(Object.keys((headers as unknown as { shape: Record<string, unknown> }).shape), r.operationId).toContain(
        "x-csrf-token",
      );
    }
  });

  it("requires If-Match on every PATCH (optimistic concurrency)", () => {
    for (const r of routes.filter((x) => x.method === "PATCH" && x.path.startsWith("/v1/jobs"))) {
      expect(
        Object.keys((r.request?.headers as unknown as { shape: Record<string, unknown> }).shape),
        r.operationId,
      ).toContain("if-match");
    }
  });

  it("declares an authorisation rule and a 401 for every session route", () => {
    for (const r of routes.filter((x) => x.auth === "session")) {
      expect(r.authz.length, r.operationId).toBeGreaterThan(5);
      expect(r.responses[401], r.operationId).toBeDefined();
    }
  });

  it("converts and fills paths", () => {
    expect(toFastifyPath("/v1/jobs/{jobId}/checkpoints/{checkpointKey}")).toBe(
      "/v1/jobs/:jobId/checkpoints/:checkpointKey",
    );
    expect(buildPath("/v1/jobs/{jobId}", { jobId: "a b" })).toBe("/v1/jobs/a%20b");
    expect(() => buildPath("/v1/jobs/{jobId}", {})).toThrow(RangeError);
  });
});
