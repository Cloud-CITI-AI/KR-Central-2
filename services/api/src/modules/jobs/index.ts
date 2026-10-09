/**
 * Jobs, dashboard cards/facets and the job detail read model. Public entry of the `jobs` module — STUB, implemented by WP-08.
 * Replace `register` with the real routes (http/ → domain/ → data/), keep `operations` accurate.
 */
import type { ApiModule } from "../../platform/module.js";

export const jobsModule: ApiModule = {
  name: "jobs",
  operations: ["listJobs", "getJobFacets", "createJob", "getJob", "updateJob", "deleteJob"],
  register() {
    // Implemented by WP-08.
  },
};
