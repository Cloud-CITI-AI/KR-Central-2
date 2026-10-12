"use client";
import { useMutation, useQuery, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { api, queryKeys } from "@/lib/api";
import { ApiProblem } from "@/lib/api/problem";
import { useBanners } from "@/lib/banner/BannerProvider";
import { MESSAGES, saveFailedMessage } from "@/lib/messages";

export interface VersionedMutationOptions<TData, TVars, TResult> {
  /** The cached entity this mutation edits (its refetch also serves the 412 reload). */
  readonly queryKey: QueryKey;
  /** `If-Match` version for this write, taken from the cached entity (e.g. the checkpoint inside a job). */
  readonly getVersion: (current: TData, vars: TVars) => number;
  readonly mutationFn: (vars: TVars, ifMatch: number) => Promise<TResult>;
  /** Show the change at once. Must leave the version untouched: the server's answer replaces it. */
  readonly optimistic?: (current: TData, vars: TVars) => TData;
}

/**
 * Optimistic write with optimistic concurrency (§14): applies the change, sends `If-Match`, rolls back on failure.
 * A 412 reloads the entity and shows the §5.1 stale banner; any other failure shows the save-failed banner.
 */
export function useOptimisticVersionedMutation<TData, TVars, TResult = unknown>(
  options: VersionedMutationOptions<TData, TVars, TResult>,
) {
  const { queryKey, getVersion, mutationFn, optimistic } = options;
  const queryClient = useQueryClient();
  const banners = useBanners();
  return useMutation<TResult, Error, TVars, { previous: TData | undefined }>({
    mutationFn: (vars) => {
      const current = queryClient.getQueryData<TData>(queryKey);
      if (current === undefined) throw new Error("Nothing loaded to change");
      return mutationFn(vars, getVersion(current, vars));
    },
    onMutate: async (vars) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<TData>(queryKey);
      if (previous !== undefined && optimistic) queryClient.setQueryData(queryKey, optimistic(previous, vars));
      return { previous };
    },
    onError: async (error, _vars, context) => {
      if (context?.previous !== undefined) queryClient.setQueryData(queryKey, context.previous);
      if (error instanceof ApiProblem && error.isStale) {
        await queryClient.refetchQueries({ queryKey });
        banners.show("stale", MESSAGES.stale);
      } else {
        banners.show("save-failed", saveFailedMessage(error));
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });
}

/**
 * Polling delay for an asynchronous operation: 1 s, backing off ×1.5 to 5 s.
 * `repolls` is the number of re-polls already made, so 0 gives the first re-poll its 1 s.
 */
export function pollDelay(repolls: number): number {
  return Math.min(5000, 1000 * 1.5 ** repolls);
}

/** Poll `GET /v1/operations/{id}` until it succeeds or fails (extraction, conformance read, email parse, scan). */
export function useOperation(operationId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.operation(operationId ?? ""),
    queryFn: ({ signal }) => api("getOperation", { params: { operationId: operationId ?? "" }, signal }),
    enabled: Boolean(operationId),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (status === "succeeded" || status === "failed") return false;
      // refetchInterval is evaluated after a fetch has succeeded, so one update means no re-poll yet.
      return pollDelay(Math.max(0, query.state.dataUpdateCount - 1));
    },
  });
}
