"use client";
import type { Operation } from "@kr/contracts";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
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

/** The task a settled `file.scan` queued for its file (a conformance read, an email parse), when it queued one. */
export function followUpOf(operation: Operation | undefined): string | null {
  if (operation?.status !== "succeeded" || !operation.result || !("followUpOperationId" in operation.result))
    return null;
  return operation.result.followUpOperationId;
}

/** Resolves after `ms`, or at once when `signal` aborts. */
function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

/**
 * Poll one operation with the same key and back-off as `useOperation` (so a component following the same id shares the cached
 * answer) until it settles, then refresh the job. Resolves with the settled operation, or null when stopped or when a poll fails
 * (the periodic job refetch still shows the outcome). An imperative loop, not `useQueries`, to keep that observer code out of the
 * tracker's first load.
 */
async function settle(queryClient: QueryClient, id: string, signal: AbortSignal): Promise<Operation | null> {
  for (let repolls = 0; ; repolls++) {
    try {
      const operation = await queryClient.query({
        queryKey: queryKeys.operation(id),
        queryFn: ({ signal: querySignal }) => api("getOperation", { params: { operationId: id }, signal: querySignal }),
        // What another observer of the same operation fetched within this poll's delay is reused, not fetched again.
        staleTime: pollDelay(repolls),
      });
      if (isSettled(operation)) {
        if (!signal.aborted) void refreshJob(queryClient);
        return operation;
      }
    } catch {
      return null;
    }
    await wait(pollDelay(repolls), signal);
    if (signal.aborted) return null;
  }
}

/**
 * Follow several operations at once (what an upload of many files queues: one file.scan each) and refresh the job once for each
 * that settles, so a scanned file shows as clean (or not) at once instead of at the next periodic refetch. When a scan settles
 * having queued a task for its file (`followUpOperationId`: the conformance read of 4.2, the parse of an email) that task is
 * followed too and refreshes the job when it settles.
 */
export function useFollowedOperations(operationIds: readonly string[]): void {
  const queryClient = useQueryClient();
  const done = useRef(new Set<string>());
  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    const follow = async (id: string): Promise<void> => {
      if (done.current.has(id)) return;
      const operation = await settle(queryClient, id, signal);
      if (!operation || signal.aborted) return;
      done.current.add(id);
      const next = followUpOf(operation);
      if (next) await follow(next);
    };
    for (const id of operationIds) void follow(id);
    return () => {
      controller.abort();
    };
  }, [operationIds, queryClient]);
}
