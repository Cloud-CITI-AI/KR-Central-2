import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, expectTypeOf, it } from "vitest";
import { deriveRouteTable } from "./route-table-derive.js";
import {
  ROUTES,
  buildPath as routesBuildPath,
  toFastifyPath as routesToFastifyPath,
  type OperationId,
  type RouteDef,
} from "./routes.js";
import { ROUTE_TABLE, buildPath, getRouteEntry, toFastifyPath, type RouteTableOperationId } from "./routes-table.js";

const routes = ROUTES as readonly RouteDef[];

describe("route table (schema-free entry point)", () => {
  it("has one entry per operation of the route registry, with the same method and path", () => {
    expect(Object.keys(ROUTE_TABLE).sort()).toEqual(routes.map((r) => r.operationId).sort());
    for (const route of routes) {
      expect(getRouteEntry(route.operationId as RouteTableOperationId), route.operationId).toMatchObject({
        method: route.method,
        path: route.path,
      });
    }
    expectTypeOf<RouteTableOperationId>().toEqualTypeOf<OperationId>();
  });

  it("matches what routes.ts declares, header by header (regenerate with `pnpm openapi:generate` when this fails)", () => {
    expect(ROUTE_TABLE).toEqual(deriveRouteTable(routes));
  });

  it("states the header requirements the API enforces", () => {
    expect(getRouteEntry("getJob")).toMatchObject({ csrf: false, ifMatch: null, idempotencyKey: null });
    expect(getRouteEntry("updateCheckpoint")).toMatchObject({ csrf: true, ifMatch: "required" });
    expect(getRouteEntry("updateCondition")).toMatchObject({ csrf: true, ifMatch: "required" });
    expect(getRouteEntry("startConditionsExtraction")).toMatchObject({ csrf: true, idempotencyKey: "required" });
    expect(getRouteEntry("startConformanceReading")).toMatchObject({ csrf: true, idempotencyKey: "required" });
    expect(getRouteEntry("createAccessGrant")).toMatchObject({ csrf: true, idempotencyKey: "optional" });
    expect(getRouteEntry("uploadFile")).toMatchObject({ multipart: true, idempotencyKey: "optional" });
  });

  it("requires CSRF on every state-changing route that has a session", () => {
    for (const route of routes.filter((r) => r.auth === "session" && r.method !== "GET")) {
      expect(getRouteEntry(route.operationId as RouteTableOperationId).csrf, route.operationId).toBe(true);
    }
  });

  it("fills and converts paths exactly as routes.ts does", () => {
    expect(buildPath).toBe(routesBuildPath);
    expect(toFastifyPath).toBe(routesToFastifyPath);
    expect(buildPath("/v1/jobs/{jobId}", { jobId: "a b" })).toBe("/v1/jobs/a%20b");
    expect(() => buildPath("/v1/jobs/{jobId}", {})).toThrow(RangeError);
  });
});

/** The browser imports this entry point to avoid Zod: nothing it loads at runtime may reach Zod or the schemas. */
describe("route table has no schema dependency", () => {
  const read = (file: string) => readFileSync(fileURLToPath(new URL(file, import.meta.url)), "utf8");
  const imports = (source: string) =>
    [...source.matchAll(/^(?:import|export)\s+(?!type\b)[^;]*?from\s+"([^"]+)"/gms)].map((m) => m[1] ?? "");

  it("only imports schema-free modules, transitively", () => {
    const allowed = new Set(["./gen/routes-table.js", "./path.js"]);
    const seen = new Set<string>();
    const walk = (file: string) => {
      for (const specifier of imports(read(file))) {
        expect(allowed.has(specifier) || specifier === "../route-table-derive.js", `${file} imports ${specifier}`).toBe(
          true,
        );
        if (seen.has(specifier)) continue;
        seen.add(specifier);
        if (specifier.startsWith("./")) walk(specifier.replace(/\.js$/, ".ts"));
      }
    };
    walk("./routes-table.ts");
    expect([...seen].sort()).toEqual(["./gen/routes-table.js", "./path.js"]);
    expect(imports(read("./gen/routes-table.ts"))).toEqual([]);
    expect(imports(read("./path.ts"))).toEqual([]);
  });
});
