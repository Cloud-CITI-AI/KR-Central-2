"use client";
import { api } from "@/lib/api";
import { applyCheckpointEdit, type UpdateCheckpointBody } from "./cache";
import { useCheckpointWrite } from "./useCheckpointWrite";

/**
 * `updateCheckpoint` (status, responsibility or KR note) with `If-Match` on the checkpoint's version (§5.4, §14).
 * Optimistic; 412 reloads the job and shows the stale banner, other failures roll back and show the save-failed banner.
 */
export function useUpdateCheckpoint(jobId: string, checkpointKey: string) {
  return useCheckpointWrite<UpdateCheckpointBody>({
    jobId,
    checkpointKey,
    run: (body, current) =>
      api("updateCheckpoint", { params: { jobId, checkpointKey }, body, ifMatch: current.version }),
    optimistic: (job, body) => applyCheckpointEdit(job, checkpointKey, body),
  });
}
