import type { IncomingMessage } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { createInstrumentations, isProbeRequest } from "./instrumentations.js";

let created: ReturnType<typeof createInstrumentations> = [];
afterEach(() => {
  for (const i of created) i.disable();
  created = [];
});

describe("createInstrumentations", () => {
  it("enables only http, pg, undici and fastify (fs and dns are off)", () => {
    created = createInstrumentations();
    const names = created.map((i) => i.instrumentationName).sort();
    expect(names).toEqual([
      "@fastify/otel",
      "@opentelemetry/instrumentation-http",
      "@opentelemetry/instrumentation-pg",
      "@opentelemetry/instrumentation-undici",
    ]);
  });

  it("does not report SQL parameters and skips health probes", () => {
    created = createInstrumentations();
    const pg = created.find((i) => i.instrumentationName.endsWith("-pg"))?.getConfig() as Record<string, unknown>;
    expect(pg).toMatchObject({ enhancedDatabaseReporting: false, requireParentSpan: true });
    const http = created.find((i) => i.instrumentationName.endsWith("-http"))?.getConfig() as {
      ignoreIncomingRequestHook: (req: IncomingMessage) => boolean;
    };
    expect(http.ignoreIncomingRequestHook({ url: "/healthz" } as IncomingMessage)).toBe(true);
    expect(http.ignoreIncomingRequestHook({ url: "/v1/jobs" } as IncomingMessage)).toBe(false);
    const fastify = created.find((i) => i.instrumentationName === "@fastify/otel")?.getConfig() as {
      registerOnInitialization: boolean;
      ignorePaths: (route: { url: string; method: string }) => boolean;
    };
    expect(fastify.registerOnInitialization).toBe(true);
    expect(fastify.ignorePaths({ url: "/readyz", method: "GET" })).toBe(true);
    expect(fastify.ignorePaths({ url: "/v1/jobs/:id", method: "GET" })).toBe(false);
  });
});

describe("isProbeRequest", () => {
  it.each([
    ["/healthz", true],
    ["/readyz?verbose=1", true],
    ["/v1/healthz", false],
    ["", false],
    [undefined, false],
  ])("%s -> %s", (url, expected) => {
    expect(isProbeRequest(url)).toBe(expected);
  });
});
