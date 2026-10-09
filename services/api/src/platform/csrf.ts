/**
 * CSRF defence for cookie sessions (PRODUCT_SPEC §3.2): every state-changing request needs the session's own
 * `X-CSRF-Token` (compared in constant time) AND an `Origin` equal to PUBLIC_BASE_URL. SameSite=Lax on the session
 * cookie is a second layer, not a substitute.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { ApiConfig } from "../config.js";
import { ForbiddenError } from "./errors.js";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Constant-time string comparison (digests first, so the lengths never leak). */
export function safeEqual(a: string, b: string): boolean {
  return timingSafeEqual(createHash("sha256").update(a).digest(), createHash("sha256").update(b).digest());
}

export function registerCsrf(app: FastifyInstance, deps: { config: Pick<ApiConfig, "PUBLIC_BASE_URL"> }): void {
  const allowedOrigin = new URL(deps.config.PUBLIC_BASE_URL).origin;

  app.addHook("onRequest", (request, _reply, done) => {
    // Public routes carry no session, so there is nothing to forge; all of them are GET anyway.
    if (SAFE_METHODS.has(request.method) || !request.auth) {
      done();
      return;
    }
    const token = request.headers["x-csrf-token"];
    const ok =
      request.headers.origin === allowedOrigin &&
      typeof token === "string" &&
      safeEqual(token, request.auth.session.csrfToken);
    done(ok ? undefined : new ForbiddenError({ detail: "Request origin or CSRF token not accepted." }));
  });
}
