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
  it("exposes exactly the eight kr.* instruments with their attributes", async () => {
    const { meter, collect } = setup();
    const m = createMetrics(meter);
    m.recordOperation({ type: "file.scan", status: "succeeded", durationSeconds: 3 });
    m.recordOperation({ type: "file.scan", status: "succeeded" });
    m.recordOperation({ type: "email.parse", status: "failed" });
    m.observeQueueDepth(() => 7);
    m.observeQueueAge(() => 42);
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
    expect(points(all, "kr.operations.queue_age").map((p) => [p.attributes, p.value])).toEqual([[{}, 42]]);
    expect(points(all, "kr.files.scanned")[0]?.attributes).toEqual({ result: "infected" });
    expect(points(all, "kr.auth.signins")[0]?.attributes).toEqual({ result: "failure" });
    expect(points(all, "kr.ai.stamp_reading")[0]?.attributes).toEqual({ result: "timeout" });
    expect(points(all, "kr.backup.runs")[0]?.attributes).toEqual({ result: "success" });
  });

  it("records the duration histogram per type and status, in seconds, only for valid durations", async () => {
    const { meter, collect } = setup();
    const m = createMetrics(meter);
    m.recordOperation({ type: "file.scan", status: "succeeded", durationSeconds: 3 });
    m.recordOperation({ type: "file.scan", status: "succeeded", durationSeconds: 150 });
    m.recordOperation({ type: "file.scan", status: "succeeded", durationSeconds: Number.NaN });
    m.recordOperation({ type: "file.scan", status: "succeeded", durationSeconds: -1 });
    m.recordOperation({ type: "email.parse", status: "failed", durationSeconds: 0 });
    m.recordOperation({ type: "email.parse", status: "failed" });
    const all = await collect();
    const histogram = all.find((x) => x.descriptor.name === "kr.operations.duration");
    expect(histogram?.descriptor.unit).toBe("s");
    const dataPoints = (histogram?.dataPoints ?? []) as {
      attributes: unknown;
      value: { count: number; sum: number; buckets: { boundaries: number[]; counts: number[] } };
    }[];
    const scan = dataPoints.find((p) => JSON.stringify(p.attributes).includes("file.scan"));
    expect(scan?.attributes).toEqual({ type: "file.scan", status: "succeeded" });
    expect(scan?.value.count).toBe(2);
    expect(scan?.value.sum).toBe(153);
    expect(scan?.value.buckets.boundaries).toEqual([0.5, 1, 2, 5, 10, 30, 60, 120, 300, 600]);
    // 3 s lands in the (2, 5] bucket and 150 s in the (120, 300] bucket.
    expect(scan?.value.buckets.counts).toEqual([0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0]);
    expect(dataPoints.find((p) => JSON.stringify(p.attributes).includes("email.parse"))?.value.count).toBe(1);
    // The counter still sees every call.
    expect(points(all, "kr.operations.processed").reduce((n, p) => n + (p.value as number), 0)).toBe(6);
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
    m.recordOperation({ type: leak, status: "failed", durationSeconds: 1 } as never);
    m.observeQueueDepth(() => ({ [leak]: 4, [`Lot 4 Smith St`]: 5 }) as never);
    m.observeQueueAge(() => ({ [leak]: 4, "file.scan": 9, "x@y.test": 12 }) as never);
    const all = await collect();
    const values = all.flatMap((x) => x.dataPoints.flatMap((p) => Object.values(p.attributes)));
    expect(new Set(values)).toEqual(new Set(["other", "failed", "file.scan"]));
    expect(values.filter((v) => v === "other").length).toBeGreaterThanOrEqual(8);
    // Unknown types collapse into one "other" series: depths add up, ages keep the oldest.
    expect(points(all, "kr.operations.queue_depth").map((p) => [p.attributes, p.value])).toEqual([
      [{ type: "other" }, 9],
    ]);
    expect(points(all, "kr.operations.queue_age").map((p) => [p.attributes, p.value])).toEqual([
      [{ type: "other" }, 12],
      [{ type: "file.scan" }, 9],
    ]);
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

  it("observes depth and age per operation type, sync or async, skipping bad values", async () => {
    const { meter, collect } = setup();
    const m = createMetrics(meter);
    let reads = 0;
    const stopDepth = m.observeQueueDepth(() => {
      reads++;
      return { "file.scan": 4, "email.parse": 0, "conditions.extract": -2 };
    });
    const stopAge = m.observeQueueAge(() => {
      reads++;
      return Promise.resolve({ "file.scan": 125.5, "email.parse": Number.NaN });
    });
    const all = await collect();
    const byType = (name: string) =>
      Object.fromEntries(points(all, name).map((p) => [(p.attributes as { type: string }).type, p.value]));
    expect(byType("kr.operations.queue_depth")).toEqual({ "file.scan": 4, "email.parse": 0 });
    expect(byType("kr.operations.queue_age")).toEqual({ "file.scan": 125.5 });
    stopDepth();
    stopAge();
    const before = reads;
    await collect();
    expect(before).toBe(2);
    expect(reads).toBe(before);
  });

  it("describes each instrument with a unit", async () => {
    const { meter, collect } = setup();
    const m = createMetrics(meter);
    m.recordSignin("success");
    m.observeQueueDepth(() => 0);
    m.observeQueueAge(() => 0);
    m.recordOperation({ type: "file.scan", status: "succeeded", durationSeconds: 1 });
    const all = await collect();
    const units = Object.fromEntries(all.map((x) => [x.descriptor.name, x.descriptor.unit]));
    expect(units).toEqual({
      "kr.auth.signins": "{attempt}",
      "kr.operations.processed": "{operation}",
      "kr.operations.duration": "s",
      "kr.operations.queue_depth": "{operation}",
      "kr.operations.queue_age": "s",
    });
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
      m.observeQueueAge(() => 1)();
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
