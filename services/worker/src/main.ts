/**
 * Worker entry point. Telemetry starts first (before pg is imported, OB-1) so auto-instrumentation can patch it;
 * everything else is imported afterwards. Configuration is parsed once; invalid config exits 1 (BE-2).
 */
import { hostname } from "node:os";
import { randomUUID } from "node:crypto";
import { startTelemetry } from "@kr/telemetry";
import { loadWorkerConfig } from "./config.js";
import { describeError } from "./errors.js";
import { parseOtlpHeaders } from "./runtime/lifecycle.js";

const config = loadWorkerConfig();
const telemetry = startTelemetry({
  serviceName: "kr-worker",
  serviceVersion: config.RELEASE_VERSION,
  environment: config.APP_ENV,
  otlpEndpoint: config.OTEL_EXPORTER_OTLP_ENDPOINT,
  otlpHeaders: parseOtlpHeaders(config.OTEL_EXPORTER_OTLP_HEADERS),
});

const [{ createLogger }, { createDb }, { createS3Storage }, { createMetrics }, { OperationType }, app, lifecycle] =
  await Promise.all([
    import("@kr/logger"),
    import("@kr/db"),
    import("@kr/storage"),
    import("@kr/telemetry"),
    import("@kr/contracts"),
    import("./app.js"),
    import("./runtime/lifecycle.js"),
  ]);
const { systemClock } = await import("./clock.js");
const { buildHandlers } = await import("./handlers/index.js");
const { createClamdClient } = await import("./clients/clamd.js");
const { createParser } = await import("./parsing/isolate.js");
const { createAnthropicStampReader } = await import("./clients/anthropic-stamp-reader.js");
const { createFeatureFlags } = await import("./flags.js");

const log = createLogger({ service: "kr-worker", env: config.APP_ENV, level: config.LOG_LEVEL });
const exit = (code: number): never => process.exit(code);
lifecycle.installCrashGuards(log, exit);

const db = createDb({
  connectionString: config.DATABASE_URL,
  // one connection per slot, plus the heartbeat, the requeue timer, the health probe and the sweeps
  maxConnections: config.WORKER_CONCURRENCY + 4,
  ssl: config.DATABASE_SSL,
  applicationName: "kr-worker",
});
const storage = createS3Storage({
  endpoint: config.S3_ENDPOINT,
  region: config.S3_REGION,
  bucket: config.S3_BUCKET,
  accessKeyId: config.S3_ACCESS_KEY_ID,
  secretAccessKey: config.S3_SECRET_ACCESS_KEY,
  forcePathStyle: config.S3_FORCE_PATH_STYLE,
  timeoutMs: 10_000,
});
const metrics = createMetrics({
  operationTypes: OperationType.options,
  operationStatuses: ["succeeded", "failed"] as const,
});

/** Circuit breaker transitions of an outbound dependency (BE-10): open is a warning, the rest is information. */
const circuitLogger =
  (dependency: string) =>
  ({ from, to }: { from: string; to: string }): void => {
    log[to === "open" ? "warn" : "info"](
      { event: "circuit_state_changed", dependency, from, to },
      `The ${dependency} circuit is now ${to}`,
    );
  };

const clamd = createClamdClient({
  host: config.CLAMAV_HOST,
  port: config.CLAMAV_PORT,
  timeoutMs: config.CLAMAV_TIMEOUT_MS,
  maxBytes: config.CLAMAV_STREAM_MAX_BYTES,
  breaker: { onStateChange: circuitLogger("clamd") },
});

// Flags go through OpenFeature, resolved once here (CF-4, ADR-0013).
const flags = await createFeatureFlags(config);

// The AI stamp reader exists only when the flag is on AND there is a key (ADR-0010); otherwise no Anthropic client is created.
const stampReader =
  flags.isEnabled("ai-stamp-reading") && config.ANTHROPIC_API_KEY
    ? createAnthropicStampReader({
        apiKey: config.ANTHROPIC_API_KEY,
        model: config.ANTHROPIC_MODEL,
        timeoutMs: config.ANTHROPIC_TIMEOUT_MS,
      })
    : undefined;

try {
  const worker = await app.startWorker({
    config,
    db,
    storage,
    log,
    metrics,
    clock: systemClock,
    workerId: `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`,
    handlers: buildHandlers({
      db,
      storage,
      clamd,
      parser: createParser(),
      clock: systemClock,
      flags,
      stampReader,
      config,
      metrics,
    }),
  });
  if (config.MALWARE_SCAN_MODE === "required" && !(await clamd.ping())) {
    log.warn(
      { event: "clamd_unreachable", host: config.CLAMAV_HOST },
      "clamd did not answer PING; scans will be retried",
    );
  }
  const shutdown = lifecycle.createShutdown({
    drain: (timeoutMs) => worker.drain(timeoutMs),
    closers: [() => worker.close(), () => db.destroy(), () => telemetry.shutdown()],
    log,
    exit,
  });
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
} catch (err) {
  log.fatal({ event: "startup_failed", ...describeError(err) }, "Worker failed to start");
  exit(1);
}
