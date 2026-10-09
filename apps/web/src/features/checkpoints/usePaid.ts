"use client";
import { api } from "@/lib/api";
import { useCheckpointWrite } from "./useCheckpointWrite";

/**
 * `markPaid` (§5.5): the client's response button (INVOICE PAID, WORKS COMPLETE …) records the time and the API sets the
 * checkpoint to Completed. The card shows the checkpoint the API answers with (no optimistic edit).
 */
export function useMarkPaid(jobId: string, checkpointKey: string) {
  return useCheckpointWrite<undefined>({
    jobId,
    checkpointKey,
    run: () => api("markPaid", { params: { jobId, checkpointKey } }),
  });
}

/** `undoPaid`: clears the response and the API sets the checkpoint back to Not completed. */
export function useUndoPaid(jobId: string, checkpointKey: string) {
  return useCheckpointWrite<undefined>({
    jobId,
    checkpointKey,
    run: () => api("undoPaid", { params: { jobId, checkpointKey } }),
  });
}
