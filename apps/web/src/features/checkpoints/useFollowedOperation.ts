"use client";
import type { Operation } from "@kr/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { useOperation } from "@/lib/query/hooks";
import { refreshJob } from "./refreshJob";

/**
 * Follow an asynchronous operation (1 s polling backing off to 5 s, until it succeeds or fails) and refresh the job once
 * when it is over, so what it changed (the conformed date, the outcome date) shows. `null` follows nothing.
 */
export function useFollowedOperation(operationId: string | null): Operation | undefined {
  const queryClient = useQueryClient();
  const { data } = useOperation(operationId);
  const refreshed = useRef<string | null>(null);
  const settled = data?.status === "succeeded" || data?.status === "failed";
  useEffect(() => {
    if (!settled || !operationId || refreshed.current === operationId) return;
    refreshed.current = operationId;
    void refreshJob(queryClient);
  }, [settled, operationId, queryClient]);
  return operationId ? data : undefined;
}
