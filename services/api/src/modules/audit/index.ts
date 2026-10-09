/**
 * Audit trail, read only (PRODUCT_SPEC §9.2). Public entry of the `audit` module (WP-11). Other modules write events
 * with `platform/audit.ts` in the same transaction as their change; nothing here writes.
 */
import type { ApiModule } from "../../platform/module.js";
import { registerAuditRoutes } from "./http/routes.js";

export const auditModule: ApiModule = {
  name: "audit",
  operations: ["listAuditEvents"],
  register(app, deps) {
    registerAuditRoutes(app, deps);
  },
};
