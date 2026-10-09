/** User administration (PRODUCT_SPEC §9.1). Public entry of the `users` module (WP-11); listUsers here, updateUser in the next change. */
import type { ApiModule } from "../../platform/module.js";
import { registerUserRoutes } from "./http/routes.js";

export const usersModule: ApiModule = {
  name: "users",
  operations: ["listUsers", "updateUser"],
  register(app, deps) {
    registerUserRoutes(app, deps);
  },
};
