/**
 * Access manager grants (PRODUCT_SPEC §3.4, §6) and optional Entra B2B invitations (ADR-0014, flag
 * `entra-guest-invites`). Public entry of the `access` module (WP-11). Audit actions (entity_type `access_grant`,
 * job_id set): `access_grant.created` (`email`, `role`, `status`), `access_grant.revoked` (`status`),
 * `access_grant.invitation_sent` / `access_grant.invitation_failed` (`invitationStatus`).
 */
import type { ApiModule } from "../../platform/module.js";
import { createGraphInviter } from "./data/graph-inviter.js";
import type { GuestInviter } from "./domain/guest-inviter.js";
import { registerAccessRoutes } from "./http/routes.js";

/** `inviter` replaces the Microsoft Graph adapter (tests pass a fake; nothing calls Graph without the flag). */
export function createAccessModule(options: { readonly inviter?: GuestInviter } = {}): ApiModule {
  return {
    name: "access",
    operations: ["listAccessGrants", "createAccessGrant", "revokeAccessGrant"],
    register(app, deps) {
      registerAccessRoutes(
        app,
        deps,
        options.inviter ?? createGraphInviter({ config: deps.config, clock: deps.clock }),
      );
    },
  };
}

export const accessModule: ApiModule = createAccessModule();
