"use client";
import type { Operation } from "@kr/contracts";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { api, queryKeys } from "@/lib/api";
import { pollDelay, useOperation } from "@/lib/query/hooks";
import { refreshJob } from "./refreshJob";

const isSettled = (operation: Operation | undefined): boolean =>
  operation?.status === "succeeded" || operation?.status === "failed";

/**
 * Follow an asynchronous operation (1 s polling backing off to 5 s, until it succeeds or fails) and refresh the job once
 * when it is over, so what it changed (the conformed date, the outcome date) shows. `null` follows nothing.
 */
export function useFollowedOperation(operationId: string | null): Operation | undefined {
  const queryClient = useQueryClient();
  const { data } = useOperation(operationId);
  const refreshed = useRef<string | null>(null);
  const settled = isSettled(data);
  useEffect(() => {
    if (!settled || !operationId || refreshed.current === operationId) return;
    refreshed.current = operationId;
    void refreshJob(queryClient);
  }, [settled, operationId, queryClient]);
  return operationId ? data : undefined;
}

/**
 * Follow several operations at once (what an upload of many files queues: one file.scan each) with the same polling as
 * `useOperation`, and refresh the job once for each that settles, so a scanned file shows as clean (or not) at once instead of at
 * the next periodic refetch. The queries are the ones `useOperation` uses, so a component following the same id shares them.
 */
export function useFollowedOperations(operationIds: readonly string[]): void {
  const queryClient = useQueryClient();
  const results = useQueries({
    queries: operationIds.map((id) => ({
      queryKey: queryKeys.operation(id),
      queryFn: ({ signal }: { signal: AbortSignal }) => api("getOperation", { params: { operationId: id }, signal }),
      refetchInterval: (query: { state: { data: Operation | undefined; dataUpdateCount: number } }) =>
        isSettled(query.state.data) ? (false as const) : pollDelay(Math.max(0, query.state.dataUpdateCount - 1)),
    })),
  });
  const refreshed = useRef(new Set<string>());
  // Operation ids are UUIDs, so the comma-joined list is a stable dependency for "which ones have settled".
  const settledKey = results.flatMap((result, i) => (isSettled(result.data) ? [operationIds[i] ?? ""] : [])).join();
  useEffect(() => {
    const fresh = settledKey.split(",").filter((id) => id !== "" && !refreshed.current.has(id));
    if (fresh.length === 0) return;
    for (const id of fresh) refreshed.current.add(id);
    void refreshJob(queryClient);
  }, [settledKey, queryClient]);
}
