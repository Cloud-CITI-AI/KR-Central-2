"use client";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { api, queryKeys } from "@/lib/api";
import type { DashboardStatus } from "./types";

/** Dashboard counts within the status filter (§6). Kept while the next filter loads so the chips do not blink. */
export function useJobFacets(status: DashboardStatus) {
  return useQuery({
    queryKey: queryKeys.jobs.facets({ status }),
    queryFn: ({ signal }) => api("getJobFacets", { query: { status }, signal }),
    placeholderData: keepPreviousData,
  });
}
