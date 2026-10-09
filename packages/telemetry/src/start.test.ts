import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { context, metrics, propagation, ROOT_CONTEXT, SpanKind, trace } from "@opentelemetry/api";
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";
import { tracing } from "@opentelemetry/sdk-node";
import { afterEach, describe, expect, it } from "vitest";
import {
  createSampler,
  normaliseSampleRatio,
  startTelemetry,
  type TelemetryConfig,
  type TelemetryRuntime,
} from "./start.js";

const base: TelemetryConfig = { serviceName: "kr-test", serviceVersion: "1.2.3", environment: "test" };
let handle: TelemetryRuntime | undefined;
const servers: Server[] = [];

afterEach(async () => {
  await handle?.shutdown();
  handle = undefined;
  for (const s of servers.splice(0)) {
    s.closeAllConnections();
    s.close();
  }
  trace.disable();
  metrics.disable();
  context.disable();
  propagation.disable();
});

function listen(onRequest: (req: IncomingMessage, body: string) => "hang" | undefined): Promise<{ url: string }> {
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c: Buffer) => (body += c.toString()));
    req.on("end", () => {
      if (onRequest(req, body) !== "hang") res.writeHead(200, { "content-type": "application/json" }).end("{}");
    });
  });
  servers.push(server);
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => {
      resolve({ url: `http://127.0.0.1:${String((server.address() as AddressInfo).port)}` });
    }),
  );
}

describe("startTelemetry without an endpoint", () => {
  it.each([undefined, "", "   "])("is a no-op for endpoint %j", async (otlpEndpoint) => {
    handle = startTelemetry({ ...base, otlpEndpoint });
    expect(handle.status).toBe("disabled");
    expect(trace.getTracer("t").startSpan("x").isRecording()).toBe(false);
    await expect(handle.shutdown()).resolves.toBeUndefined();
  });

  it("never throws for a malformed endpoint and reports the error on the handle", async () => {
    for (const otlpEndpoint of ["not a url", "ftp://example.test"]) {
      const failed = startTelemetry({ ...base, otlpEndpoint });
      expect(failed.status).toBe("failed");
      expect(failed.error).toBeInstanceOf(Error);
      await expect(failed.shutdown()).resolves.toBeUndefined();
    }
  });
});

describe("startTelemetry with in-memory exporters", () => {
  it("produces spans and metrics tagged with the service resource and no host or process detail", async () => {
    const spanExporter = new tracing.InMemorySpanExporter();
    const metricExporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    const metricReader = new PeriodicExportingMetricReader({ exporter: metricExporter, exportIntervalMillis: 60_000 });
    handle = startTelemetry({ ...base, sampleRatio: 1 }, { spanExporter, metricReader });
    expect(handle.status).toBe("started");

    trace.getTracer("t").startSpan("work").end();
    metrics.getMeter("t").createCounter("kr.test.count").add(1, { result: "ok" });
    await metricReader.forceFlush();

    const [span] = spanExporter.getFinishedSpans();
    expect(span?.name).toBe("work");
    expect(span?.resource.attributes).toMatchObject({
      "service.name": "kr-test",
      "service.version": "1.2.3",
      "deployment.environment.name": "test",
    });
    expect(Object.keys(span?.resource.attributes ?? {})).not.toEqual(
      expect.arrayContaining(["host.name", "process.command_args"]),
    );
    const metric = metricExporter
      .getMetrics()
      .flatMap((m) => m.scopeMetrics)
      .flatMap((s) => s.metrics)
      .find((m) => m.descriptor.name === "kr.test.count");
    expect(metric?.dataPoints[0]?.value).toBe(1);
  });

  it("scrubs personal data before the exporter sees a span", () => {
    const spanExporter = new tracing.InMemorySpanExporter();
    handle = startTelemetry({ ...base, sampleRatio: 1 }, { spanExporter });
    const span = trace.getTracer("t").startSpan("GET");
    span.setAttributes({ "client.address": "203.0.113.5", "url.full": "https://x.test/p?email=a@b.test" });
    span.end();
    expect(spanExporter.getFinishedSpans()[0]?.attributes).toEqual({ "url.full": "https://x.test/p" });
  });

  it("samples by ratio at the root and follows the parent's decision below it", () => {
    const decide = (ratio: number, parent: boolean) => {
      const sampler = createSampler(ratio);
      const ctx = parent
        ? trace.setSpanContext(ROOT_CONTEXT, {
            traceId: "a".repeat(32),
            spanId: "b".repeat(16),
            traceFlags: 1,
            isRemote: true,
          })
        : ROOT_CONTEXT;
      return sampler.shouldSample(ctx, "c".repeat(32), "n", SpanKind.SERVER, {}, []).decision;
    };
    expect(decide(0, false)).toBe(0);
    expect(decide(1, false)).toBe(2);
    expect(decide(0, true)).toBe(2);
    expect([normaliseSampleRatio(undefined), normaliseSampleRatio(Number.NaN)]).toEqual([0.1, 0.1]);
    expect([normaliseSampleRatio(-1), normaliseSampleRatio(7), normaliseSampleRatio(0.25)]).toEqual([0, 1, 0.25]);
  });
});

describe("startTelemetry with an OTLP endpoint", () => {
  it("exports spans and metrics over OTLP/HTTP with the configured headers, without personal data", async () => {
    const seen: { path: string | undefined; auth: string | undefined; body: string }[] = [];
    const { url } = await listen((req, body) => {
      seen.push({ path: req.url, auth: req.headers.authorization, body });
      return undefined;
    });
    handle = startTelemetry({
      ...base,
      otlpEndpoint: `${url}/`,
      otlpHeaders: { authorization: "Bearer test" },
      sampleRatio: 1,
    });
    const span = trace.getTracer("t").startSpan("export-me");
    span.setAttribute("client.address", "203.0.113.5");
    span.end();
    metrics.getMeter("t").createCounter("kr.test.count").add(1);
    await handle.shutdown();

    expect(seen.map((s) => s.path).sort()).toEqual(["/v1/metrics", "/v1/traces"]);
    expect(seen.every((s) => s.auth === "Bearer test")).toBe(true);
    const traces = seen.find((s) => s.path === "/v1/traces")?.body ?? "";
    expect(traces).toContain("export-me");
    expect(traces).not.toContain("203.0.113.5");
    expect(seen.find((s) => s.path === "/v1/metrics")?.body).toContain("kr.test.count");
  });

  it.each([
    ["a closed port", () => Promise.resolve("http://127.0.0.1:9")],
    ["a server that never answers", async () => (await listen(() => "hang")).url],
  ])(
    "shuts down within 5 s against %s",
    async (_name, endpoint) => {
      handle = startTelemetry({ ...base, otlpEndpoint: await endpoint(), sampleRatio: 1 });
      trace.getTracer("t").startSpan("lost").end();
      metrics.getMeter("t").createCounter("kr.test.count").add(1);
      const started = performance.now();
      await expect(handle.shutdown()).resolves.toBeUndefined();
      expect(performance.now() - started).toBeLessThan(5000);
    },
    15_000,
  );

  it("gives up at shutdownTimeoutMs and records the timeout", async () => {
    const { url } = await listen(() => "hang");
    handle = startTelemetry({ ...base, otlpEndpoint: url, sampleRatio: 1, shutdownTimeoutMs: 100 });
    trace.getTracer("t").startSpan("lost").end();
    const started = performance.now();
    await handle.shutdown();
    expect(performance.now() - started).toBeLessThan(1500);
    expect(handle.error).toBeInstanceOf(Error);
  });
});
