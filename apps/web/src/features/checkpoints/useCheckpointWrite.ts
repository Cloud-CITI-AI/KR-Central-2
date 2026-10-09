"use client";
import type { CheckpointState, JobDetail } from "@kr/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ApiProblem, queryKeys } from "@/lib/api";
import { useBanners } from "@/lib/banner/BannerProvider";
import { MESSAGES, saveFailedText } from "@/lib/messages";
import { mapCheckpoint } from "./cache";
import { refreshJob } from "./refreshJob";

export interface CheckpointWriteOptions<TVars> {
  readonly jobId: string;
  readonly checkpointKey: string;
  /** The API call. `current` is the cached checkpoint when the write starts, so `If-Match` carries the version the last write produced. */
  readonly run: (vars: TVars, current: CheckpointState) => Promise<CheckpointState>;
  /** Show the change at once. Must leave `version` alone: the server's answer replaces it. */
  readonly optimistic?: (job: JobDetail, vars: TVars) => JobDetail;
  /** Statuses the caller shows next to its own control (e.g. 400 on the decline comment); no banner for these. */
  readonly inlineStatuses?: readonly number[];
}

/**
 * One write to a checkpoint (status, responsibility, KR note, decision, paid), with the job cache kept in step.
 * Writes to the same checkpoint run one after the other (a queued write starts from the version the previous one made).
 * Failure puts the checkpoint back: 412 reloads the job and shows the stale banner (§5.1), anything else the save-failed
 * banner. After success the job is refreshed so the progress, stage bars and dashboard follow.
 */
export function useCheckpointWrite<TVars>({
  jobId,
  checkpointKey,
  run,
  optimistic,
  inlineStatuses = [],
}: CheckpointWriteOptions<TVars>) {
  const queryClient = useQueryClient();
  const banners = useBanners();
  const queryKey = queryKeys.jobs.detail(jobId);
  const mutationKey = ["checkpoint", jobId, checkpointKey] as const;
  const pendingWrites = () => queryClient.isMutating({ mutationKey: ["checkpoint", jobId] });

  return useMutation<CheckpointState, Error, TVars, { previous: CheckpointState | undefined }>({
    mutationKey,
    scope: { id: mutationKey.join("-") },
    mutationFn: (vars) => {
      const current = queryClient.getQueryData<JobDetail>(queryKey)?.checkpoints.find((c) => c.key === checkpointKey);
      if (!current) throw new Error("Nothing loaded to change");
      return run(vars, current);
    },
    onMutate: async (vars) => {
      await queryClient.cancelQueries({ queryKey });
      const job = queryClient.getQueryData<JobDetail>(queryKey);
      if (job && optimistic) queryClient.setQueryData(queryKey, optimistic(job, vars));
      return { previous: job?.checkpoints.find((c) => c.key === checkpointKey) };
    },
    onError: async (error, _vars, context) => {
      const { previous } = context ?? {};
      if (previous)
        queryClient.setQueryData<JobDetail>(
          queryKey,
          (job) => job && mapCheckpoint(job, checkpointKey, () => previous),
        );
      if (error instanceof ApiProblem && inlineStatuses.includes(error.status)) return;
      if (error instanceof ApiProblem && error.isStale) {
        await queryClient.refetchQueries({ queryKey });
        banners.show("stale", MESSAGES.stale);
      } else {
        banners.show("save-failed", saveFailedText(error instanceof ApiProblem ? error.requestId : undefined));
      }
    },
    onSuccess: (checkpoint) => {
      // Another edit of this checkpoint is queued behind this one: keep its optimistic fields, take only the new version.
      const queued = optimistic !== undefined && pendingWrites() > 1;
      queryClient.setQueryData<JobDetail>(
        queryKey,
        (job) =>
          job &&
          mapCheckpoint(job, checkpointKey, (c) =>
            queued ? { ...c, version: checkpoint.version, updatedAt: checkpoint.updatedAt } : checkpoint,
          ),
      );
      if (pendingWrites() > 1) return;
      void refreshJob(queryClient);
    },
  });
}
