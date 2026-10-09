/** Sign-in routes (PRODUCT_SPEC §3.1): startLogin and completeLogin. */
import { pseudonymise } from "@kr/logger";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { BadRequestError } from "../../../platform/errors.js";
import type { ModuleDeps } from "../../../platform/module.js";
import { defineRoute } from "../../../platform/routes.js";
import {
  SESSION_COOKIE,
  createSession,
  hashSessionId,
  isWellFormedSessionCookie,
  revokeSession,
  sessionPolicy,
  setSessionCookie,
} from "../../../platform/session.js";
import { consumeAuthFlow, createAuthFlow } from "../data/auth-flows.js";
import { provisionSignIn } from "../data/provision.js";
import { readIdentity } from "../domain/claims.js";
import { reasonForAuthorizeError, signInErrorPath, type SignInReason } from "../domain/reasons.js";
import { DEFAULT_RETURN_TO, validateReturnTo } from "../domain/return-to.js";
import {
  BINDING_COOKIE,
  clearBindingCookie,
  matchesBinding,
  newBindingValue,
  setBindingCookie,
} from "./browser-binding.js";
import { reasonForExchangeError } from "./oidc-errors.js";
import { redirectUri, type OidcClient } from "./oidc.js";

export function registerAuthRoutes(app: FastifyInstance, deps: ModuleDeps, oidc: OidcClient): void {
  defineRoute(app, "startLogin", async ({ reply, query }) => {
    const returnTo = validateReturnTo(query.returnTo);
    if (returnTo === null) throw new BadRequestError({ detail: "returnTo must be a same-origin path." });
    const secrets = oidc.newFlowSecrets();
    const bindingValue = newBindingValue();
    const url = await oidc.authorizationUrl(secrets);
    await createAuthFlow(deps.db, { ...secrets, returnTo, bindingValue, now: deps.clock.now() });
    setBindingCookie(reply, bindingValue);
    return reply.redirect(url.toString());
  });

  /** Security event (LG-3): the reason, never the token, code or address; the subject only as a pseudonym. */
  const failure = (request: FastifyRequest, reason: SignInReason, oid?: string) => {
    const subject = oid === undefined ? {} : { subject: pseudonymise(oid, deps.config.LOG_PSEUDONYM_SALT) };
    request.log.warn({ event: "authn_failure", reason, ...subject }, "Sign-in failed");
  };

  defineRoute(app, "completeLogin", async ({ request, reply, query }) => {
    clearBindingCookie(reply);
    const fail = (reason: SignInReason, oid?: string) => {
      failure(request, reason, oid);
      return reply.redirect(signInErrorPath(reason));
    };
    // Consume first: the flow is spent even when the browser check below fails, so a callback can never be retried.
    const flow = query.state === undefined ? null : await consumeAuthFlow(deps.db, query.state, deps.clock.now());
    if (
      flow === null ||
      query.state === undefined ||
      !matchesBinding(request.cookies[BINDING_COOKIE], flow.browser_binding_hash)
    )
      return fail("expired");
    if (query.error !== undefined) return fail(reasonForAuthorizeError(query.error, query.error_description));

    const callback = new URL(redirectUri(deps.config));
    callback.search = new URL(request.url, callback).search;
    let claims: Readonly<Record<string, unknown>>;
    try {
      claims = await oidc.exchange(callback, {
        state: query.state,
        nonce: flow.nonce,
        codeVerifier: flow.code_verifier,
      });
    } catch (err) {
      request.log.warn(
        { event: "authn_exchange_failed", errName: err instanceof Error ? err.name : typeof err },
        "Code exchange failed",
      );
      return fail(reasonForExchangeError(err));
    }
    const identity = readIdentity(claims, deps.config.ENTRA_TENANT_ID);
    if (!identity.ok) return fail(identity.reason);

    const now = deps.clock.now();
    const user = await provisionSignIn(deps.db, identity.identity, {
      now,
      staffDomains: deps.config.KR_STAFF_EMAIL_DOMAINS,
      requestId: request.id,
    });
    if (!user.ok) return fail(user.reason, identity.identity.oid);

    // Session fixation: whatever session this browser presented dies, and a new id is issued (never reused).
    const presented = request.cookies[SESSION_COOKIE];
    if (isWellFormedSessionCookie(presented))
      await revokeSession(deps.db, hashSessionId(presented), "rotated", deps.clock);
    const session = await createSession(
      deps.db,
      {
        userId: user.user.id,
        authTime: identity.identity.authTime ?? now,
        amr: identity.identity.amr,
        acrs: identity.identity.acrs,
        userAgent: request.headers["user-agent"] ?? null,
      },
      sessionPolicy(deps),
    );
    setSessionCookie(reply, session.cookieValue);
    request.log.info(
      {
        event: "authn_success",
        subject: pseudonymise(identity.identity.oid, deps.config.LOG_PSEUDONYM_SALT),
        role: user.user.role,
        created: user.created,
        firstAdmin: user.firstAdmin,
        grantsActivated: user.grantsActivated,
      },
      "Signed in",
    );
    return reply.redirect(validateReturnTo(flow.return_to) ?? DEFAULT_RETURN_TO);
  });
}
