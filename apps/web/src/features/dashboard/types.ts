import type { JobFacets, JobStatusFilter } from "@kr/contracts";
import type { z } from "zod";

/** The contract exports these as schemas only; the dashboard works with their parsed shapes. */
export type Facets = z.infer<typeof JobFacets>;
export type DashboardStatus = z.infer<typeof JobStatusFilter>;
