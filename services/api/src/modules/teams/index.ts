/**
 * Teams channel links of jobs (PRODUCT_SPEC §5.10, ADR-0015). Public entry of the `teams` module (WP-25). Audit
 * actions (entity_type `job_teams_link`, on the job): `job.teams_linked`, `job.teams_relinked`, `job.teams_unlinked`
 * (user). The worker records `teams.folders_provisioned` and `file.teams_pushed` (system).
 */
import type { ApiModule } from "../../platform/module.js";
import { registerTeamsChannelRoutes, registerTeamsLinkRoutes, registerTeamsUnfiledRoutes } from "./http/routes.js";

export { queueTeamsDelete } from "./data/teams-unfiled.js";
export { planChannelForNewJob, type ChannelPlan } from "./domain/channel-plan.js";
export { nameTakenIn, queueCreateChannel, readChannelCache } from "./data/teams-channels.js";

export const teamsModule: ApiModule = {
  name: "teams",
  operations: [
    "getJobTeamsLink",
    "linkJobTeamsChannel",
    "unlinkJobTeamsChannel",
    "listTeamsUnfiled",
    "fileTeamsUnfiled",
    "dismissTeamsUnfiled",
    "createJobTeamsChannel",
    "listTeamsChannels",
  ],
  register(app, deps) {
    registerTeamsLinkRoutes(app, deps);
    registerTeamsUnfiledRoutes(app, deps);
    registerTeamsChannelRoutes(app, deps);
  },
};
