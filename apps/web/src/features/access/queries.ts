"use client";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { api, queryKeys } from "@/lib/api";

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
