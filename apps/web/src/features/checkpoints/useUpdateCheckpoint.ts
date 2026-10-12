"use client";
import { ApiProblem, api } from "@/lib/api";
import { useBanners } from "@/lib/banner/BannerProvider";
import { saveFailedMessage } from "@/lib/messages";
import { applyCheckpointEdit, type UpdateCheckpointVars } from "./cache";
import { useCheckpointWrite } from "./useCheckpointWrite";

/** Failures that say more than "reload and try again": no connection (0) and rate limited (429, §14). */
const SPECIFIC_FAILURES = [0, 429];

/**
 * `updateCheckpoint` (status, responsibility or KR note) with `If-Match` on the checkpoint's version (§5.4, §14).
 * Optimistic; 412 reloads the job and shows the stale banner. Lost connection and 429 show their own banner text
 * (§5.1), other failures roll back and show the save-failed banner.
 */
export function useUpdateCheckpoint(jobId: string, checkpointKey: string) {
  const banners = useBanners();
  return useCheckpointWrite<UpdateCheckpointVars>({
    jobId,
    checkpointKey,
    run: async ({ baseVersion, ...body }, current) => {
      try {
        return await api("updateCheckpoint", {
          params: { jobId, checkpointKey },
          body,
          ifMatch: baseVersion ?? current.version,
        });
      } catch (error) {
        // `inlineStatuses` keeps the generic banner away for these; the write still rolls back.
        if (error instanceof ApiProblem && SPECIFIC_FAILURES.includes(error.status)) {
          banners.show("save-failed", saveFailedMessage(error));
        }
        throw error;
      }
    },
    optimistic: (job, body) => applyCheckpointEdit(job, checkpointKey, body),
    inlineStatuses: SPECIFIC_FAILURES,
  });
}
