import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";
import { ROUTES, type RouteDef } from "./routes.js";

/** The API rejects these two POSTs with 400 (path `idempotency-key`) when the header is missing. */
const REQUIRED_IDEMPOTENCY = ["startConditionsExtraction", "startConformanceReading"] as const;
const csrf = "c".repeat(32);

const routeOf = (operationId: string): RouteDef => {
  const route = (ROUTES as readonly RouteDef[]).find((r) => r.operationId === operationId);
  if (!route) throw new Error(`no route ${operationId}`);
  return route;
};

interface Parameter {
  readonly in: string;
  readonly name: string;
  readonly required?: boolean;
}
interface OpenApi {
  readonly paths: Record<string, Record<string, { operationId: string; parameters?: readonly Parameter[] }>>;
}

describe.each(REQUIRED_IDEMPOTENCY)("%s", (operationId) => {
  it("declares a required idempotency-key header next to the CSRF token", () => {
    const headers = routeOf(operationId).request?.headers;
    expect(headers, "headers").toBeDefined();
    expect(headers?.safeParse({ "x-csrf-token": csrf }).success, "without key").toBe(false);
    expect(headers?.safeParse({ "x-csrf-token": csrf, "idempotency-key": "k".repeat(8) }).success, "with key").toBe(
      true,
    );
    expect(headers?.safeParse({ "x-csrf-token": csrf, "idempotency-key": "short" }).success, "short key").toBe(false);
  });

  it("lists idempotency-key as a required header parameter in openapi.yaml", () => {
    const document = parse(readFileSync(fileURLToPath(new URL("../openapi.yaml", import.meta.url)), "utf8")) as OpenApi;
    const operation = Object.values(document.paths)
      .flatMap((methods) => Object.values(methods))
      .find((op) => op.operationId === operationId);
    const parameter = operation?.parameters?.find((p) => p.in === "header" && p.name === "idempotency-key");
    expect(parameter?.required).toBe(true);
  });
});
