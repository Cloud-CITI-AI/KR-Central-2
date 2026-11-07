/**
 * Teams settings (PRODUCT_SPEC §9.3, ADR-0015 A2). Public entry of the `teams-settings` module (WP-25). Audit actions
 * (entity_type `teams_settings`, no job): `settings.teams_updated` (changed columns), `settings.teams_check_started`.
 * The `teams` module (job links) reuses the link parser and the settings reader through this index.
 */
import type { ApiModule } from "../../platform/module.js";
import { registerTeamsSettingsRoutes } from "./http/routes.js";

export { checkChannelLink, parseChannelLink, buildTeamsUrl, type ParsedChannelLink } from "./domain/channel-link.js";
export { readSettingsRow } from "./data/teams-settings.js";
export { feeChannelLinkOf, FEE_CHANNEL_NAME } from "./domain/settings-view.js";

export const teamsSettingsModule: ApiModule = {
  name: "teams-settings",
  operations: ["getTeamsSettings", "updateTeamsSettings", "checkTeamsConnection"],
  register(app, deps) {
    registerTeamsSettingsRoutes(app, deps);
  },
};
