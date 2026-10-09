/**
 * User management (admin). Public entry of the `users` module — STUB, implemented by WP-11.
 * Replace `register` with the real routes (http/ → domain/ → data/), keep `operations` accurate.
 */
import type { ApiModule } from "../../platform/module.js";

export const usersModule: ApiModule = {
  name: "users",
  operations: ["listUsers", "updateUser"],
  register() {
    // Implemented by WP-11.
  },
};
