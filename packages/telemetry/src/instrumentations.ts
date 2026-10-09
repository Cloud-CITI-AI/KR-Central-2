/**
 * Auto-instrumentation set (ADR-0009): http (incoming + outgoing), pg and undici; fastify is added by the service
 * through `TelemetryConfig.instrumentations`. Everything else, fs and dns included, is switched off: they are noisy and
 * record file paths and host names.
 */
import { getNodeAutoInstrumentations, type InstrumentationConfigMap } from "@opentelemetry/auto-instrumentations-node";

export const PROBE_PATHS = ["/healthz", "/readyz"];

const DISABLED: readonly (keyof InstrumentationConfigMap)[] = [
  "@opentelemetry/instrumentation-amqplib",
  "@opentelemetry/instrumentation-aws-lambda",
  "@opentelemetry/instrumentation-aws-sdk",
  "@opentelemetry/instrumentation-bunyan",
  "@opentelemetry/instrumentation-cassandra-driver",
  "@opentelemetry/instrumentation-connect",
  "@opentelemetry/instrumentation-cucumber",
  "@opentelemetry/instrumentation-dataloader",
  "@opentelemetry/instrumentation-dns",
  "@opentelemetry/instrumentation-express",
  "@opentelemetry/instrumentation-fs",
  "@opentelemetry/instrumentation-generic-pool",
  "@opentelemetry/instrumentation-graphql",
  "@opentelemetry/instrumentation-grpc",
  "@opentelemetry/instrumentation-hapi",
  "@opentelemetry/instrumentation-host-metrics",
  "@opentelemetry/instrumentation-ioredis",
  "@opentelemetry/instrumentation-kafkajs",
  "@opentelemetry/instrumentation-knex",
  "@opentelemetry/instrumentation-koa",
  "@opentelemetry/instrumentation-lru-memoizer",
  "@opentelemetry/instrumentation-memcached",
  "@opentelemetry/instrumentation-mongodb",
  "@opentelemetry/instrumentation-mongoose",
  "@opentelemetry/instrumentation-mysql",
  "@opentelemetry/instrumentation-mysql2",
  "@opentelemetry/instrumentation-nestjs-core",
  "@opentelemetry/instrumentation-net",
  "@opentelemetry/instrumentation-openai",
  "@opentelemetry/instrumentation-oracledb",
  "@opentelemetry/instrumentation-pino",
  "@opentelemetry/instrumentation-redis",
  "@opentelemetry/instrumentation-restify",
  "@opentelemetry/instrumentation-router",
  "@opentelemetry/instrumentation-runtime-node",
  "@opentelemetry/instrumentation-socket.io",
  "@opentelemetry/instrumentation-tedious",
  "@opentelemetry/instrumentation-winston",
];

/** Liveness/readiness probes fire every few seconds and would drown real traces. */
export function isProbeRequest(url: string | undefined): boolean {
  const path = (url ?? "").split("?", 1)[0];
  return path !== undefined && PROBE_PATHS.includes(path);
}

export function createInstrumentations(): ReturnType<typeof getNodeAutoInstrumentations> {
  const config: InstrumentationConfigMap = Object.fromEntries(DISABLED.map((name) => [name, { enabled: false }]));
  config["@opentelemetry/instrumentation-http"] = {
    ignoreIncomingRequestHook: (req) => isProbeRequest(req.url),
  };
  // No parent span means background polling (worker queue claims): not worth a trace of its own.
  config["@opentelemetry/instrumentation-pg"] = { requireParentSpan: true, enhancedDatabaseReporting: false };
  return getNodeAutoInstrumentations(config);
}
