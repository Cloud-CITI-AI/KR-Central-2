/** OIDC sign-in with Entra ID, sessions, first admin, grant activation, /v1/me. Public entry of the `auth` module (WP-07). */
import type { ApiModule } from "../../platform/module.js";
import { registerAuthRoutes } from "./http/routes.js";
import { createOidcClient } from "./http/oidc.js";
import { registerSessionRoutes } from "./http/session-routes.js";

export const authModule: ApiModule = {
  name: "auth",
  operations: ["startLogin", "completeLogin", "logout", "getMe"],
  register(app, deps) {
    const oidc = createOidcClient(deps.config, deps.clock);
    registerAuthRoutes(app, deps, oidc);
    registerSessionRoutes(app, deps, oidc);
  },
};
