/**
 * API entry point. Telemetry starts first (before fastify/pg are imported, OB-1) so auto-instrumentation can patch
 * them; everything else is imported afterwards. Configuration is parsed once; invalid config exits 1 (BE-2).
 */
import { startTelemetry } from "@kr/telemetry";
import { loadApiConfig } from "./config.js";
import { parseOtlpHeaders } from "./platform/server.js";

const config = loadApiConfig();
const telemetry = startTelemetry({
  serviceName: "kr-api",
  serviceVersion: config.RELEASE_VERSION,
  environment: config.APP_ENV,
  otlpEndpoint: config.OTEL_EXPORTER_OTLP_ENDPOINT,
  otlpHeaders: parseOtlpHeaders(config.OTEL_EXPORTER_OTLP_HEADERS),
});

const [{ createLogger }, { createDb }, { buildApp }, flagsModule, storageModule, serverModule] = await Promise.all([
  import("@kr/logger"),
  import("@kr/db"),
  import("./app.js"),
  import("./platform/flags.js"),
  import("./platform/storage.js"),
  import("./platform/server.js"),
]);

const log = createLogger({ service: "api", env: config.APP_ENV, level: config.LOG_LEVEL });
const exit = (code: number): never => process.exit(code);
serverModule.installCrashGuards(log, exit);

const db = createDb({
  connectionString: config.DATABASE_URL,
  maxConnections: config.DATABASE_POOL_MAX,
  ssl: config.DATABASE_SSL,
  applicationName: "kr-api",
});
const storage = storageModule.createStorage(config);
const app = await buildApp({
  db,
  config,
  clock: flagsModule.systemClock,
  storage,
  flags: await flagsModule.createFeatureFlags(config),
  log,
});

const shutdown = serverModule.createShutdown({ app, closers: [() => db.destroy()], telemetry, log, exit });
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

try {
  await app.listen({ host: config.HOST, port: config.PORT });
  log.info(
    { event: "api_started", host: config.HOST, port: config.PORT, release: config.RELEASE_VERSION },
    "API listening",
  );
} catch (err) {
  log.fatal({ event: "startup_failed", err }, "API failed to start");
  exit(1);
}
