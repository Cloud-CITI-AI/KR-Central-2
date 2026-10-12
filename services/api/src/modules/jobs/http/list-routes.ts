/** listJobs and getJobFacets (PRODUCT_SPEC §6): the dashboard and the job picker. */
import type { FastifyInstance } from "fastify";
import { BadRequestError } from "../../../platform/errors.js";
import type { ModuleDeps } from "../../../platform/module.js";
import { requireSignedIn } from "../../../platform/authz.js";
import { defineRoute } from "../../../platform/routes.js";
import { createStampReader, FreshReads, loadRuleRows, loadStampedJobs, type JobFilters } from "../data/job-cards.js";
import { toJobCard } from "../domain/job-card.js";
import { computeFacets, decodeCursor, matchesStatus, paginate } from "../domain/job-list.js";
import type { AuthContext } from "../../../platform/auth-context.js";
import { SummaryCache, summariseWithCache, type SummarisedJob } from "../domain/job-summaries.js";

export function registerListRoutes(app: FastifyInstance, deps: ModuleDeps): void {
  // Summaries of unchanged jobs are reused between requests (the dashboard refetches the list and facets every 15 s), and
  // the requests of one viewer that arrive together share one read (see FreshReads) instead of each paying for it.
  const cache = new SummaryCache();
  const stamps = createStampReader(deps.db);
  const reads = new FreshReads<SummarisedJob[]>();
  const summaries = (auth: AuthContext, filters: JobFilters = {}) => {
    // Everything the read depends on: who may see which jobs, how the fee proposal is treated, and the SQL filters.
    const readAll = auth.globalCapabilities.includes("jobs.read_all");
    const key = JSON.stringify([auth.user.id, auth.user.role, readAll, filters.type ?? null, filters.q ?? null]);
    return reads.fresh(key, async () => {
      const { jobs, grantRoles } = await loadStampedJobs(deps.db, stamps, auth, filters);
      return summariseWithCache(jobs, grantRoles, auth.user.role, deps.clock.now(), cache, (ids) =>
        loadRuleRows(deps.db, ids),
      );
    });
  };

  defineRoute(app, "listJobs", async ({ auth, query }) => {
    // Visibility (jobs.read_all, or an active grant) is part of every query, so a caller with no jobs gets an empty page.
    requireSignedIn(auth);
    const after = query.cursor === undefined ? null : decodeCursor(query.sort, query.cursor);
    if (query.cursor !== undefined && !after) throw new BadRequestError({ detail: "The cursor is not valid." });
    const entries = (await summaries(auth, { type: query.type, q: query.q })).filter((e) =>
      matchesStatus(query.status, e),
    );
    const page = paginate(entries, query.sort, after, query.limit);
    return { items: page.items.map((e) => toJobCard(e.row, e.summary)), nextCursor: page.nextCursor };
  });

  defineRoute(app, "getJobFacets", async ({ auth, query }) => {
    requireSignedIn(auth);
    return computeFacets(await summaries(auth), query.status);
  });
}
