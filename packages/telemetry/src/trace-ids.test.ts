import { context, metrics, propagation, trace } from "@opentelemetry/api";
import { tracing } from "@opentelemetry/sdk-node";
import { afterEach, describe, expect, it } from "vitest";
import { currentTraceIds } from "./trace-ids.js";
import { startTelemetry, type TelemetryRuntime } from "./start.js";

let handle: TelemetryRuntime | undefined;
afterEach(async () => {
  await handle?.shutdown();
  handle = undefined;
  trace.disable();
  metrics.disable();
  context.disable();
  propagation.disable();
});

const start = (sampleRatio: number) => {
  handle = startTelemetry(
    { serviceName: "kr-test", serviceVersion: "0", environment: "test", sampleRatio },
    { spanExporter: new tracing.InMemorySpanExporter() },
  );
};

describe("currentTraceIds", () => {
  it("is undefined when telemetry is off or no span is active", () => {
    expect(currentTraceIds()).toBeUndefined();
    start(1);
    expect(currentTraceIds()).toBeUndefined();
  });

  it("returns the active span's ids", () => {
    start(1);
    trace.getTracer("t").startActiveSpan("req", (span) => {
      expect(currentTraceIds()).toEqual({ traceId: span.spanContext().traceId, spanId: span.spanContext().spanId });
      expect(currentTraceIds()?.traceId).toMatch(/^[0-9a-f]{32}$/);
      expect(currentTraceIds()?.spanId).toMatch(/^[0-9a-f]{16}$/);
      span.end();
    });
  });

  it("still correlates logs for requests the sampler dropped", () => {
    start(0);
    trace.getTracer("t").startActiveSpan("req", (span) => {
      expect(span.isRecording()).toBe(false);
      expect(currentTraceIds()?.traceId).toBe(span.spanContext().traceId);
      span.end();
    });
  });
});
