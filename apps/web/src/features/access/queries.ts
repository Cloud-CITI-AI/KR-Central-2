"use client";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { compareJobNumbers } from "@kr/workflow";
import { api, queryKeys } from "@/lib/api";
import type { Grant } from "./types";

/**
 * Every job the user can see, in job-number order, for the job picker: pages are fetched until the last one
 * (the picker must offer every job, not the first 100).
 */
export function useJobChoices() {
  const jobs = useInfiniteQuery({
    queryKey: queryKeys.jobs.list({ view: "picker", status: "all" }),
    queryFn: ({ pageParam, signal }) =>
      api("listJobs", { query: { status: "all", sort: "job_number", limit: 100, cursor: pageParam }, signal }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    refetchInterval: 60_000,
  });
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = jobs;
  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);
  return { ...jobs, choices: jobs.data?.pages.flatMap((page) => page.items) ?? [] };
}

/** The people on the access list (every status). "Load more" follows the cursor. */
export function useGrants() {
  return useInfiniteQuery({
    queryKey: queryKeys.grants({ view: "manager" }),
    queryFn: ({ pageParam, signal }) => api("listAccessGrants", { query: { limit: 100, cursor: pageParam }, signal }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

/** The list order of §6: by job (natural job-number order), then email. */
export function sortGrants(grants: readonly Grant[]): Grant[] {
  return grants.toSorted(
    (a, b) => compareJobNumbers(a.jobNumber, b.jobNumber) || a.email.localeCompare(b.email, "en-AU"),
  );
}
