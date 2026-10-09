/**
 * Access manager grants and optional Entra B2B invitations. Public entry of the `access` module — STUB, implemented by WP-11.
 * Replace `register` with the real routes (http/ → domain/ → data/), keep `operations` accurate.
 */
import type { ApiModule } from "../../platform/module.js";

export const accessModule: ApiModule = {
  name: "access",
  operations: ["listAccessGrants", "createAccessGrant", "revokeAccessGrant"],
  register() {
    // Implemented by WP-11.
  },
};
