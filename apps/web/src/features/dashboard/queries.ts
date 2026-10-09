"use client";
import { keepPreviousData, useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { api, queryKeys } from "@/lib/api";
import type { DashboardParams } from "./params";
import type { DashboardStatus } from "./types";

/** Dashboard counts within the status filter (§6). Kept while the next filter loads so the chips do not blink. */
export function useJobFacets(status: DashboardStatus) {
  return useQuery({
    queryKey: queryKeys.jobs.facets({ status }),
    queryFn: ({ signal }) => api("getJobFacets", { query: { status }, signal }),
    placeholderData: keepPreviousData,
  });
}

/** Cards per page (§6): "load more" fetches the next 50. */
export const PAGE_SIZE = 50;

/**
 * The dashboard's cards for the filters in the URL, most alerts first then job number (the API sorts, `sort=attention`).
 * `view` keeps this infinite query apart from the plain list queries of the job picker.
 */
export function useJobList({ status, type, q }: Pick<DashboardParams, "status" | "type" | "q">) {
  return useInfiniteQuery({
    queryKey: queryKeys.jobs.list({ view: "dashboard", status, type, q }),
    queryFn: ({ pageParam, signal }) =>
      api("listJobs", {
        query: {
          status,
          sort: "attention",
          limit: PAGE_SIZE,
          type: type || undefined,
          q: q || undefined,
          cursor: pageParam,
        },
        signal,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  });
}
