/**
 * User administration (PRODUCT_SPEC §9.1). Public entry of the `users` module (WP-11). Audit actions (entity_type
 * `user`, no job): `user.role_changed` (`role`), `user.status_changed` (`status`); each change also revokes the user's
 * sessions (reason `role_changed`, or `user_disabled` when the user is disabled).
 */
import type { ApiModule } from "../../platform/module.js";
import { registerUserRoutes } from "./http/routes.js";

export const usersModule: ApiModule = {
  name: "users",
  operations: ["listUsers", "updateUser"],
  register(app, deps) {
    registerUserRoutes(app, deps);
  },
};
