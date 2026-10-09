/**
 * Response hardening for a JSON API: helmet with a deny-everything CSP (the API never serves documents the browser may
 * render), no-store caching by default (responses are per-user), and no framework fingerprint. Routes that need
 * caching (file content) set their own Cache-Control, which is left untouched.
 */
import helmet from "@fastify/helmet";
import type { FastifyInstance } from "fastify";

export async function registerSecurityHeaders(app: FastifyInstance): Promise<void> {
  await app.register(helmet, {
    contentSecurityPolicy: { useDefaults: false, directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
    referrerPolicy: { policy: "no-referrer" },
    crossOriginResourcePolicy: { policy: "same-origin" },
    hsts: { maxAge: 31_536_000, includeSubDomains: true },
  });
  app.addHook("onSend", (_request, reply, payload, done) => {
    if (!reply.hasHeader("cache-control")) void reply.header("cache-control", "no-store");
    done(null, payload);
  });
}
