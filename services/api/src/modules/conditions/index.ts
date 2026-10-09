/**
 * WAPC conditions and document-reading requests. Public entry of the `conditions` module (WP-10): starting the Decision
 * Letter extraction and the conformance reading as tracked operations (the worker, WP-12, does the reading), and editing
 * a condition within the caller's field permissions. Audit action names: see README.md.
 */
import type { ApiModule } from "../../platform/module.js";
import { registerStartRoutes } from "./http/start-routes.js";
import { registerUpdateConditionRoute } from "./http/update-condition.js";

export const conditionsModule: ApiModule = {
  name: "conditions",
  operations: ["startConditionsExtraction", "updateCondition", "startConformanceReading"],
  register(app, deps) {
    registerStartRoutes(app, deps);
    registerUpdateConditionRoute(app, deps);
  },
};
