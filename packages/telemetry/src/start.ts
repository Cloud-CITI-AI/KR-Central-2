/**
 * OpenTelemetry bootstrap (playbook OB-1/OB-2). Call startTelemetry() FIRST in each service entry point, before
 * fastify/pg are imported, so the instrumentations can patch them. Without an OTLP endpoint it does nothing (an
 * external backend needs KR approval, ADR-0009/X7) and it never throws: a failure is reported through the handle.
 */
import { randomUUID } from "node:crypto";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { PeriodicExportingMetricReader, type IMetricReader } from "@opentelemetry/sdk-metrics";
import { NodeSDK, tracing } from "@opentelemetry/sdk-node";
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from "@opentelemetry/semantic-conventions";
import { createInstrumentations } from "./instrumentations.js";
import { ScrubbingSpanExporter } from "./scrub.js";

export const DEFAULT_SAMPLE_RATIO = 0.1;
export const DEFAULT_SHUTDOWN_TIMEOUT_MS = 5000;
const EXPORT_TIMEOUT_MS = 3000;

type SdkInstrumentations = NonNullable<NonNullable<ConstructorParameters<typeof NodeSDK>[0]>["instrumentations"]>;

export interface TelemetryConfig {
  readonly serviceName: string;
  readonly serviceVersion: string;
  readonly environment: string;
  /** OTLP/HTTP base URL (signal paths are appended); undefined or empty disables telemetry entirely. */
  readonly otlpEndpoint?: string | undefined;
  /** Extra OTLP headers, e.g. authorization for the backend. */
  readonly otlpHeaders?: Readonly<Record<string, string>> | undefined;
  /** Fraction of new root traces sampled, 0..1 (default 0.1). Children follow their parent's decision. */
  readonly sampleRatio?: number | undefined;
  /** Upper bound for shutdown() to resolve (default 5000 ms). */
  readonly shutdownTimeoutMs?: number | undefined;
  /**
   * Extra instrumentations on top of createInstrumentations(), which already covers http, pg, undici AND Fastify.
   * Do NOT pass a Fastify instrumentation here: a second one fails with "decorator already added".
   */
  readonly instrumentations?: SdkInstrumentations | undefined;
}

/** Test seam: replaces the OTLP exporters (spans are then processed synchronously). */
export interface TelemetryTestHooks {
  readonly spanExporter?: tracing.SpanExporter;
  readonly metricReader?: IMetricReader;
}

/** What services hold on to: only shutdown() is needed to stop. */
export interface TelemetryHandle {
  /** Flushes and stops; always resolves, within `shutdownTimeoutMs`. */
  shutdown(): Promise<void>;
}

/** The handle startTelemetry returns, with enough state for the caller to log how startup went. */
export interface TelemetryRuntime extends TelemetryHandle {
  /** "disabled" = no endpoint (no-op), "failed" = startup threw (see `error`), "started" = SDK running. */
  readonly status: "disabled" | "started" | "failed";
  /** The startup error, or the last shutdown error/timeout. */
  readonly error?: unknown;
}

/** Clamps to 0..1; NaN and non-numbers fall back to the default. */
export function normaliseSampleRatio(ratio: number | undefined): number {
  if (ratio === undefined || Number.isNaN(ratio)) return DEFAULT_SAMPLE_RATIO;
  return Math.min(1, Math.max(0, ratio));
}

export function createSampler(ratio: number | undefined): tracing.Sampler {
  return new tracing.ParentBasedSampler({ root: new tracing.TraceIdRatioBasedSampler(normaliseSampleRatio(ratio)) });
}

function signalUrl(base: string, signal: "traces" | "metrics"): string {
  const url = new URL(base);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("OTLP endpoint must be http(s)");
  return `${base.replace(/\/+$/, "")}/v1/${signal}`;
}

function createPipelines(config: TelemetryConfig, hooks: TelemetryTestHooks | undefined) {
  const endpoint = config.otlpEndpoint?.trim();
  const exporterOptions = { headers: { ...config.otlpHeaders }, timeoutMillis: EXPORT_TIMEOUT_MS };
  const spanProcessor = hooks?.spanExporter
    ? new tracing.SimpleSpanProcessor(new ScrubbingSpanExporter(hooks.spanExporter))
    : endpoint
      ? new tracing.BatchSpanProcessor(
          new ScrubbingSpanExporter(new OTLPTraceExporter({ ...exporterOptions, url: signalUrl(endpoint, "traces") })),
          { exportTimeoutMillis: EXPORT_TIMEOUT_MS },
        )
      : undefined;
  const metricReader =
    hooks?.metricReader ??
    (endpoint
      ? new PeriodicExportingMetricReader({
          exporter: new OTLPMetricExporter({ ...exporterOptions, url: signalUrl(endpoint, "metrics") }),
          exportIntervalMillis: 60_000,
          exportTimeoutMillis: EXPORT_TIMEOUT_MS,
        })
      : undefined);
  return { spanProcessor, metricReader };
}

function disableAll(instrumentations: readonly unknown[]): void {
  for (const entry of instrumentations.flat(Infinity) as { disable?: () => void }[]) entry.disable?.();
}

export function startTelemetry(config: TelemetryConfig, hooks?: TelemetryTestHooks): TelemetryRuntime {
  const enabled =
    Boolean(config.otlpEndpoint?.trim()) || hooks?.spanExporter !== undefined || hooks?.metricReader !== undefined;
  if (!enabled) return { status: "disabled", shutdown: () => Promise.resolve() };
  let sdk: NodeSDK;
  const instrumentations = [createInstrumentations(), ...(config.instrumentations ?? [])];
  try {
    const { spanProcessor, metricReader } = createPipelines(config, hooks);
    sdk = new NodeSDK({
      // No host/process detectors: process.command_args and host.name can carry secrets and machine names.
      autoDetectResources: false,
      resource: resourceFromAttributes({
        [ATTR_SERVICE_NAME]: config.serviceName,
        [ATTR_SERVICE_VERSION]: config.serviceVersion,
        "service.instance.id": randomUUID(),
        "deployment.environment.name": config.environment,
      }),
      sampler: createSampler(config.sampleRatio),
      ...(spanProcessor ? { spanProcessors: [spanProcessor] } : {}),
      ...(metricReader ? { metricReaders: [metricReader] } : {}),
      instrumentations,
    });
    sdk.start();
  } catch (error: unknown) {
    return { status: "failed", error, shutdown: () => Promise.resolve() };
  }
  const timeoutMs = config.shutdownTimeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS;
  const handle: { status: "started"; error?: unknown; shutdown(): Promise<void> } = {
    status: "started",
    async shutdown() {
      let timer: NodeJS.Timeout | undefined;
      const timedOut = new Promise<void>((resolve) => {
        timer = setTimeout(() => {
          handle.error = new Error(`telemetry shutdown exceeded ${String(timeoutMs)} ms`);
          resolve();
        }, timeoutMs);
      });
      const stopped = sdk.shutdown().catch((error: unknown) => {
        handle.error = error;
      });
      // The SDK leaves its instrumentations patched; disabling them lets a restarted SDK (tests) install fresh ones.
      disableAll(instrumentations);
      await Promise.race([stopped, timedOut]);
      clearTimeout(timer);
    },
  };
  return handle;
}
