/**
 * Access manager grants (PRODUCT_SPEC §3.4, §6) and, from 11-c, optional Entra B2B invitations. Public entry of the
 * `access` module (WP-11). Audit actions (entity_type `access_grant`, job_id set): `access_grant.created`
 * (`email`, `role`, `status`), `access_grant.revoked` (`status`).
 */
import type { ApiModule } from "../../platform/module.js";
import { registerAccessRoutes } from "./http/routes.js";

export const accessModule: ApiModule = {
  name: "access",
  operations: ["listAccessGrants", "createAccessGrant", "revokeAccessGrant"],
  register(app, deps) {
    registerAccessRoutes(app, deps);
  },
};
