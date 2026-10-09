/**
 * Jobs, dashboard cards/facets and the job detail read model. Public entry of the `jobs` module (WP-08).
 * Audit action names: see README.md.
 */
import type { ApiModule } from "../../platform/module.js";
import { registerJobRoutes } from "./http/job-routes.js";
import { registerListRoutes } from "./http/list-routes.js";

export const jobsModule: ApiModule = {
  name: "jobs",
  operations: ["listJobs", "getJobFacets", "createJob", "getJob", "updateJob", "deleteJob"],
  register(app, deps) {
    registerListRoutes(app, deps);
    registerJobRoutes(app, deps);
  },
};

/** For the checkpoints module: one checkpoint as the viewer sees it, and the job version bump every checkpoint write makes. */
export { loadCheckpointView, type JobViewer } from "./http/job-view.js";
export { bumpJobVersion } from "./data/job-updates.js";
