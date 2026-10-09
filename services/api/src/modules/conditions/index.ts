/**
 * WAPC conditions and document-reading requests. Public entry of the `conditions` module — STUB, implemented by WP-10.
 * Replace `register` with the real routes (http/ → domain/ → data/), keep `operations` accurate.
 */
import type { ApiModule } from "../../platform/module.js";

export const conditionsModule: ApiModule = {
  name: "conditions",
  operations: ["startConditionsExtraction", "updateCondition", "startConformanceReading"],
  register() {
    // Implemented by WP-10.
  },
};
