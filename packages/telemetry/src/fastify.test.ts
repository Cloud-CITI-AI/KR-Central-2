import { createRequire } from "node:module";
import { context, metrics, propagation, SpanKind, trace } from "@opentelemetry/api";
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";
import { tracing } from "@opentelemetry/sdk-node";
import { afterEach, describe, expect, it } from "vitest";
import { startTelemetry, type TelemetryRuntime } from "./start.js";

// fastify is loaded with require, after startTelemetry, so the instrumentations can patch it (as the services do).
const require = createRequire(import.meta.url);
interface App {
  get(path: string, handler: (req: unknown, reply: unknown) => unknown): void;
  inject(opts: { method: string; url: string }): Promise<{ statusCode: number }>;
  listen(opts: { port: number; host: string }): Promise<string>;
  close(): Promise<void>;
}

let handle: TelemetryRuntime | undefined;
let app: App | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
  await handle?.shutdown();
  handle = undefined;
  trace.disable();
  metrics.disable();
  context.disable();
  propagation.disable();
});

async function boot() {
  const spanExporter = new tracing.InMemorySpanExporter();
  const metricExporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
  const metricReader = new PeriodicExportingMetricReader({ exporter: metricExporter, exportIntervalMillis: 60_000 });
  handle = startTelemetry(
    { serviceName: "kr-api-test", serviceVersion: "0", environment: "test", sampleRatio: 1 },
    { spanExporter, metricReader },
  );
  const fastify = (require("fastify") as () => App)();
  fastify.get("/v1/jobs/:id", () => ({ ok: true }));
  fastify.get("/healthz", () => ({ ok: true }));
  const address = await fastify.listen({ port: 0, host: "127.0.0.1" });
  app = fastify;
  return { spanExporter, metricExporter, metricReader, address };
}

describe("Fastify instrumentation", () => {
  it("puts the route template on the server span and the http.server duration metric, without the query string", async () => {
    const { spanExporter, metricExporter, metricReader, address } = await boot();
    const res = await fetch(`${address}/v1/jobs/42?email=a@b.com#x`);
    expect(res.status).toBe(200);
    await metricReader.forceFlush();

    const spans = spanExporter.getFinishedSpans();
    const server = spans.find((s) => s.kind === SpanKind.SERVER && s.attributes["http.route"] === "/v1/jobs/:id");
    expect(server).toBeDefined();
    expect(JSON.stringify(spans.map((s) => s.attributes))).not.toContain("a@b.com");
    const duration = metricExporter
      .getMetrics()
      .flatMap((m) => m.scopeMetrics)
      .flatMap((s) => s.metrics)
      .find((m) => m.descriptor.name === "http.server.request.duration");
    expect(duration?.dataPoints.some((p) => p.attributes["http.route"] === "/v1/jobs/:id")).toBe(true);
  });

  it("does not trace health probes", async () => {
    const { spanExporter, address } = await boot();
    await fetch(`${address}/healthz`);
    // The test's own fetch() produces a client span; nothing may be recorded on the server side.
    expect(spanExporter.getFinishedSpans().filter((s) => s.kind === SpanKind.SERVER)).toEqual([]);
  });
});
