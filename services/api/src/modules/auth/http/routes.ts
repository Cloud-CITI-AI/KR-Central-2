/** Sign-in routes (PRODUCT_SPEC §3.1): startLogin here; completeLogin follows in the next PR. */
import { BadRequestError } from "../../../platform/errors.js";
import type { ModuleDeps } from "../../../platform/module.js";
import { defineRoute } from "../../../platform/routes.js";
import type { FastifyInstance } from "fastify";
import { createAuthFlow } from "../data/auth-flows.js";
import { validateReturnTo } from "../domain/return-to.js";
import { newBindingValue, setBindingCookie } from "./browser-binding.js";
import type { OidcClient } from "./oidc.js";

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
}
