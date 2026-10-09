/**
 * OIDC sign-in with Entra ID, sessions, first admin, grant activation, /v1/me. Public entry of the `auth` module — STUB, implemented by WP-07.
 * Replace `register` with the real routes (http/ → domain/ → data/), keep `operations` accurate.
 */
import type { ApiModule } from "../../platform/module.js";

export const authModule: ApiModule = {
  name: "auth",
  operations: ["startLogin", "completeLogin", "logout", "getMe"],
  register() {
    // Implemented by WP-07.
  },
};
