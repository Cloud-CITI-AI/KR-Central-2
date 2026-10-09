/**
 * Audit trail (read). Public entry of the `audit` module — STUB, implemented by WP-11.
 * Replace `register` with the real routes (http/ → domain/ → data/), keep `operations` accurate.
 */
import type { ApiModule } from "../../platform/module.js";

export const auditModule: ApiModule = {
  name: "audit",
  operations: ["listAuditEvents"],
  register() {
    // Implemented by WP-11.
  },
};
