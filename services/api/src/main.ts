/**
 * API entry point (skeleton). WP-01 replaces this with: telemetry first, buildApp(deps), graceful shutdown.
 */
import Fastify from "fastify";
import { loadApiConfig } from "./config.js";

const config = loadApiConfig();
const app = Fastify({ logger: { level: config.LOG_LEVEL } });

app.get("/healthz", () => ({ status: "ok", checks: {} }));

app.listen({ port: config.PORT, host: config.HOST }).catch((err: unknown) => {
  app.log.error({ event: "startup_failed", err }, "API failed to start");
  process.exit(1);
});
