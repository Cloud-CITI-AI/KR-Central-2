"use client";
import { api } from "@/lib/api";
import { useCheckpointWrite } from "./useCheckpointWrite";

export interface DecisionVars {
  readonly value: "accepted" | "declined";
  readonly comment: string;
}

/**
 * `recordDecision` (§5.5): the client's approve/accept or decline, with the comment. It does not touch the checkpoint's status,
 * and the checkpoint is replaced by the API's answer (no optimistic edit). A 400 (decline without a comment) is left to the
 * form to show next to the textarea; any other failure shows the save-failed banner.
 */
export function useRecordDecision(jobId: string, checkpointKey: string) {
  return useCheckpointWrite<DecisionVars>({
    jobId,
    checkpointKey,
    run: (body) => api("recordDecision", { params: { jobId, checkpointKey }, body }),
    inlineStatuses: [400],
  });
}
