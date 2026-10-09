"use client";
import { useInfiniteQuery, useMutation, useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { useEffect } from "react";
import { compareJobNumbers } from "@kr/workflow";
import { api, queryKeys } from "@/lib/api";
import type { Grant, GrantPage } from "./types";

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

const grantsKey = queryKeys.grants({ view: "manager" });

/**
 * Revoke a grant (§6 "Remove? Yes/No"). The row turns REVOKED at once and is put back if the API refuses; the list is
 * reloaded afterwards either way.
 */
export function useRevokeGrant() {
  const queryClient = useQueryClient();
  return useMutation<undefined, Error, Grant, { previous: InfiniteData<GrantPage> | undefined }>({
    mutationFn: (grant) => api("revokeAccessGrant", { params: { grantId: grant.id } }),
    onMutate: async (grant) => {
      await queryClient.cancelQueries({ queryKey: grantsKey });
      const previous = queryClient.getQueryData<InfiniteData<GrantPage>>(grantsKey);
      if (previous) {
        queryClient.setQueryData<InfiniteData<GrantPage>>(grantsKey, {
          ...previous,
          pages: previous.pages.map((page) => ({
            ...page,
            items: page.items.map((item) => (item.id === grant.id ? { ...item, status: "revoked" as const } : item)),
          })),
        });
      }
      return { previous };
    },
    onError: (_error, _grant, context) => {
      if (context?.previous) queryClient.setQueryData(grantsKey, context.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.grants() }),
  });
}
