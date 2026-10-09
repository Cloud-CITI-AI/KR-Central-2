/**
 * Status of asynchronous operations. Public entry of the `operations` module (WP-10): `getOperation`, the poll target of
 * every 202 + Location answer. `toOperation` is exported for the modules that start operations (conditions, files), so
 * the contract shape and its user-safe error messages are mapped once.
 */
import type { ApiModule } from "../../platform/module.js";
import { registerGetOperationRoute } from "./http/get-operation.js";

export const operationsModule: ApiModule = {
  name: "operations",
  operations: ["getOperation"],
  register(app, deps) {
    registerGetOperationRoute(app, deps);
  },
};

export { toOperation } from "./domain/operation-view.js";
