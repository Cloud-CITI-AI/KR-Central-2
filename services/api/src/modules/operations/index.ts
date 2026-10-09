/**
 * Status of asynchronous operations. Public entry of the `operations` module — STUB, implemented by WP-10.
 * Replace `register` with the real routes (http/ → domain/ → data/), keep `operations` accurate.
 */
import type { ApiModule } from "../../platform/module.js";

export const operationsModule: ApiModule = {
  name: "operations",
  operations: ["getOperation"],
  register() {
    // Implemented by WP-10.
  },
};
