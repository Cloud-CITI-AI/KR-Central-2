/**
 * Application factory (ADR-0004). buildApp wires the platform (problem+json errors, contract-driven routes, health) and
 * registers every module in MODULES, so the same app runs in production (main.ts) and in tests (test/helpers).
 */
import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import Fastify, { LogController, type FastifyBaseLogger, type FastifyInstance } from "fastify";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import { MODULES } from "./modules/index.js";
import { registerCsrf } from "./platform/csrf.js";
import { registerErrorHandling } from "./platform/errors.js";
import { registerHealthRoutes } from "./platform/health.js";
import type { ApiModule, ModuleDeps } from "./platform/module.js";
import { trackOperations } from "./platform/routes.js";
import { registerSessionAuth } from "./platform/session-auth.js";

export { registeredOperations, unregisteredOperations } from "./platform/routes.js";

const REQUEST_ID = /^[A-Za-z0-9._-]{8,64}$/;

/** Reuse a well-formed inbound X-Request-ID (set by the web BFF) so one id follows the request end to end. */
export function requestIdFor(req: Pick<IncomingMessage, "headers">): string {
  const inbound = req.headers["x-request-id"];
  return typeof inbound === "string" && REQUEST_ID.test(inbound) ? inbound : randomUUID();
}

export interface BuildAppOptions {
  /** Modules to register; tests append routes of their own. Defaults to every module in MODULES. */
  readonly modules?: readonly ApiModule[];
}

export async function buildApp(deps: ModuleDeps, opts: BuildAppOptions = {}): Promise<FastifyInstance> {
  const loggerInstance: FastifyBaseLogger = deps.log;
  const app: FastifyInstance = Fastify({
    loggerInstance,
    // Our own request_completed line (below) replaces Fastify's: it must not log the query string (OIDC code/state).
    logController: new LogController({ disableRequestLogging: true, requestIdLogLabel: "requestId" }),
    genReqId: requestIdFor,
  });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  // JSON only (contract): Fastify's built-in text/plain parser would turn a media-type error into a validation error.
  app.removeContentTypeParser("text/plain");
  app.decorateRequest("auth", null);
  trackOperations(app);
  registerErrorHandling(app);

  app.addHook("onSend", (request, reply, payload, done) => {
    void reply.header("x-request-id", request.id);
    done(null, payload);
  });
  app.addHook("onResponse", (request, reply, done) => {
    request.log.info(
      {
        event: "request_completed",
        method: request.method,
        route: request.routeOptions.url ?? "unmatched",
        status: reply.statusCode,
        durationMs: Math.round(reply.elapsedTime),
        ...(request.auth ? { userId: request.auth.user.id } : {}),
      },
      "Request completed",
    );
    done();
  });

  await registerSessionAuth(app, deps);
  registerCsrf(app, deps);
  registerHealthRoutes(app, deps);
  for (const mod of opts.modules ?? MODULES) {
    await app.register(async (scope) => {
      await mod.register(scope, deps);
    });
  }
  return app;
}
