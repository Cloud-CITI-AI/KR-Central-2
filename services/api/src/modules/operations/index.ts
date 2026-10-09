/**
 * Status of asynchronous operations. Public entry of the `operations` module (WP-10).
 * `toOperation` is exported for the modules that start operations (conditions, files), so the contract shape is mapped once.
 */
import type { ApiModule } from "../../platform/module.js";

export const operationsModule: ApiModule = {
  name: "operations",
  operations: ["getOperation"],
  register() {
    // Registered by 10-c (getOperation).
  },
};

export { toOperation } from "./domain/operation-view.js";
