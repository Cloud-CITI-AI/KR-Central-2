/** listJobs and getJobFacets (PRODUCT_SPEC §6): the dashboard and the job picker. */
import type { FastifyInstance } from "fastify";
import { BadRequestError } from "../../../platform/errors.js";
import type { ModuleDeps } from "../../../platform/module.js";
import { requireSignedIn } from "../../../platform/authz.js";
import { defineRoute } from "../../../platform/routes.js";
import { loadJobsForSummary } from "../data/job-cards.js";
import { toJobCard } from "../domain/job-card.js";
import { computeFacets, decodeCursor, matchesStatus, paginate } from "../domain/job-list.js";
import { summariseLoaded } from "../domain/job-summaries.js";

export function registerListRoutes(app: FastifyInstance, deps: ModuleDeps): void {
  defineRoute(app, "listJobs", async ({ auth, query }) => {
    // Visibility (jobs.read_all, or an active grant) is part of every query, so a caller with no jobs gets an empty page.
    requireSignedIn(auth);
    const after = query.cursor === undefined ? null : decodeCursor(query.sort, query.cursor);
    if (query.cursor !== undefined && !after) throw new BadRequestError({ detail: "The cursor is not valid." });
    const loaded = await loadJobsForSummary(deps.db, auth, { type: query.type, q: query.q });
    const entries = summariseLoaded(loaded, auth.user.role, deps.clock.now()).filter((e) =>
      matchesStatus(query.status, e),
    );
    const page = paginate(entries, query.sort, after, query.limit);
    return { items: page.items.map((e) => toJobCard(e.row, e.summary)), nextCursor: page.nextCursor };
  });

  defineRoute(app, "getJobFacets", async ({ auth, query }) => {
    requireSignedIn(auth);
    const loaded = await loadJobsForSummary(deps.db, auth);
    return computeFacets(summariseLoaded(loaded, auth.user.role, deps.clock.now()), query.status);
  });
}
