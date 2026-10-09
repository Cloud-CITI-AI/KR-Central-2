/** OIDC sign-in with Entra ID, sessions, first admin, grant activation, /v1/me. Public entry of the `auth` module (WP-07). */
import type { ApiModule } from "../../platform/module.js";
import { registerAuthRoutes } from "./http/routes.js";
import { createOidcClient } from "./http/oidc.js";

export const authModule: ApiModule = {
  name: "auth",
  operations: ["startLogin", "completeLogin", "logout", "getMe"],
  register(app, deps) {
    registerAuthRoutes(app, deps, createOidcClient(deps.config, deps.clock));
  },
};
