import { metrics } from "@opentelemetry/api";
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
  type MetricData,
} from "@opentelemetry/sdk-metrics";
import { afterEach, describe, expect, it } from "vitest";
import { createMetrics, getMeter, METRIC_NAMES, type KrMetrics } from "./metrics.js";
import { startTelemetry, type TelemetryRuntime } from "./start.js";

function setup() {
  const exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
  const reader = new PeriodicExportingMetricReader({ exporter, exportIntervalMillis: 60_000 });
  const provider = new MeterProvider({ readers: [reader] });
  const collect = async (): Promise<MetricData[]> => {
    exporter.reset();
    await reader.forceFlush();
    return exporter.getMetrics().flatMap((m) => m.scopeMetrics.flatMap((s) => s.metrics));
  };
  return { meter: provider.getMeter("test"), collect, provider };
}

const points = (all: MetricData[], name: string) => all.find((m) => m.descriptor.name === name)?.dataPoints ?? [];

describe("createMetrics", () => {
  it("exposes exactly the six kr.* instruments with their attributes", async () => {
    const { meter, collect } = setup();
    const m = createMetrics(meter);
    m.recordOperation({ type: "file.scan", status: "succeeded" });
    m.recordOperation({ type: "file.scan", status: "succeeded" });
    m.recordOperation({ type: "email.parse", status: "failed" });
    m.observeQueueDepth(() => 7);
    m.recordFileScan("infected");
    m.recordSignin("failure");
    m.recordStampReading("timeout");
    m.recordBackupRun("success");
    const all = await collect();

    expect(all.map((x) => x.descriptor.name).sort()).toEqual(Object.values(METRIC_NAMES).sort());
    const ops = points(all, "kr.operations.processed").map((p) => [p.attributes, p.value]);
    expect(ops).toContainEqual([{ type: "file.scan", status: "succeeded" }, 2]);
    expect(ops).toContainEqual([{ type: "email.parse", status: "failed" }, 1]);
    expect(points(all, "kr.operations.queue_depth").map((p) => [p.attributes, p.value])).toEqual([[{}, 7]]);
    expect(points(all, "kr.files.scanned")[0]?.attributes).toEqual({ result: "infected" });
    expect(points(all, "kr.auth.signins")[0]?.attributes).toEqual({ result: "failure" });
    expect(points(all, "kr.ai.stamp_reading")[0]?.attributes).toEqual({ result: "timeout" });
    expect(points(all, "kr.backup.runs")[0]?.attributes).toEqual({ result: "success" });
  });

  it("records anything outside the closed label sets as 'other', so no personal data can enter a metric", async () => {
    const { meter, collect } = setup();
    const m = createMetrics(meter);
    const leak = "jo.bloggs@example.test";
    m.recordOperation({ type: leak, status: "Lot 4 Smith St" } as never);
    m.recordFileScan(leak as never);
    m.recordSignin(leak as never);
    m.recordStampReading(leak as never);
    m.recordBackupRun(leak as never);
    const all = await collect();
    const values = all.flatMap((x) => x.dataPoints.flatMap((p) => Object.values(p.attributes)));
    expect(values).toEqual(["other", "other", "other", "other", "other", "other"]);
    expect(JSON.stringify(all)).not.toMatch(/example\.test|Smith/);
  });

  it("observes the queue depth per collection (async reader), skips bad readings and can be unregistered", async () => {
    const { meter, collect } = setup();
    const m = createMetrics(meter);
    let reading = 3;
    let reads = 0;
    const stop = m.observeQueueDepth(() => {
      reads++;
      return Promise.resolve(reading);
    });
    expect(points(await collect(), "kr.operations.queue_depth")[0]?.value).toBe(3);
    reading = 9;
    expect(points(await collect(), "kr.operations.queue_depth")[0]?.value).toBe(9);
    reading = Number.NaN;
    expect(points(await collect(), "kr.operations.queue_depth")[0]?.value).toBe(9);
    reading = -1;
    expect(points(await collect(), "kr.operations.queue_depth")[0]?.value).toBe(9);
    stop();
    const before = reads;
    await collect();
    expect(reads).toBe(before);
  });

  it("describes each instrument with a unit", async () => {
    const { meter, collect } = setup();
    const m = createMetrics(meter);
    m.recordSignin("success");
    m.observeQueueDepth(() => 0);
    const all = await collect();
    expect(all.map((x) => x.descriptor.unit)).toEqual(["{operation}", "{attempt}"]);
  });
});

describe("default meter", () => {
  let handle: TelemetryRuntime | undefined;
  afterEach(async () => {
    await handle?.shutdown();
    handle = undefined;
    metrics.disable();
  });

  it("is a harmless no-op before telemetry starts", () => {
    const m: KrMetrics = createMetrics();
    expect(() => {
      m.recordOperation({ type: "file.scan", status: "failed" });
      m.observeQueueDepth(() => 1)();
    }).not.toThrow();
    expect(getMeter()).toBeDefined();
  });

  it("reaches the reader that startTelemetry registered", async () => {
    const exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    const metricReader = new PeriodicExportingMetricReader({ exporter, exportIntervalMillis: 60_000 });
    handle = startTelemetry({ serviceName: "kr-test", serviceVersion: "0", environment: "test" }, { metricReader });
    createMetrics().recordBackupRun("failure");
    await metricReader.forceFlush();
    const all = exporter.getMetrics().flatMap((m) => m.scopeMetrics.flatMap((s) => s.metrics));
    expect(points(all, "kr.backup.runs")[0]?.attributes).toEqual({ result: "failure" });
  });
});
