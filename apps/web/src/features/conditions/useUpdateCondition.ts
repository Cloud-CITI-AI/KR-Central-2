"use client";
import type { Condition, JobDetail } from "@kr/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, ApiProblem, queryKeys } from "@/lib/api";
import { useBanners } from "@/lib/banner/BannerProvider";
import { MESSAGES, saveFailedText } from "@/lib/messages";
import { applyConditionEdit, mapCondition, type UpdateConditionBody } from "./cache";
import { refreshJob } from "@/features/checkpoints";

/** `condition` with the comments `body` sets: the only fields kept when a save is refused as stale. */
function withTypedComments(condition: Condition, body: UpdateConditionBody): Condition {
  return {
    ...condition,
    krComment: body.krComment ?? condition.krComment,
    clientComment: body.clientComment ?? condition.clientComment,
  };
}

/** The condition is no longer on the page: a new extraction replaced it (§15). Handled like a 404. */
class ConditionGone extends Error {}

/**
 * `updateCondition` (tick, agency, responsibility, KR or client comment) with `If-Match` on the condition's version (§5.6, §14).
 * Optimistic: the change shows at once in the checklist and in the agency box, which read the same job. Writes to one condition run
 * one after the other, each from the version the one before it made. A 412 (someone else changed the same field; a typed comment stays on the reloaded condition) or a 404 (it was replaced by a
 * new extraction, §15) puts the condition back, reloads the job and shows the stale banner; any other failure puts it back and shows
 * the save-failed banner. After success the job is refreshed so the stage bars and the progress follow an agency change.
 */
export function useUpdateCondition(jobId: string, conditionId: string) {
  const queryClient = useQueryClient();
  const banners = useBanners();
  const queryKey = queryKeys.jobs.detail(jobId);
  const mutationKey = ["condition", jobId, conditionId] as const;
  const pendingWrites = () => queryClient.isMutating({ mutationKey });
  const conditionIn = (job: JobDetail | undefined) => job?.conditions.find((c) => c.id === conditionId);

  return useMutation<Condition, Error, UpdateConditionBody, { previous: Condition | undefined }>({
    mutationKey,
    scope: { id: mutationKey.join("-") },
    mutationFn: (body) => {
      const current = conditionIn(queryClient.getQueryData<JobDetail>(queryKey));
      if (!current) throw new ConditionGone("The condition is not loaded any more");
      return api("updateCondition", { params: { jobId, conditionId }, body, ifMatch: current.version });
    },
    onMutate: async (body) => {
      await queryClient.cancelQueries({ queryKey });
      const job = queryClient.getQueryData<JobDetail>(queryKey);
      if (job) queryClient.setQueryData(queryKey, applyConditionEdit(job, conditionId, body));
      return { previous: conditionIn(job) };
    },
    onError: async (error, body, context) => {
      const { previous } = context ?? {};
      if (previous)
        queryClient.setQueryData<JobDetail>(queryKey, (job) => job && mapCondition(job, conditionId, () => previous));
      if (error instanceof ConditionGone || (error instanceof ApiProblem && (error.isStale || error.status === 404))) {
        await queryClient.refetchQueries({ queryKey });
        // A comment someone typed is never thrown away (§5.6, §15): it stays on the reloaded condition, with its new version.
        if (error instanceof ApiProblem && error.isStale) {
          queryClient.setQueryData<JobDetail>(
            queryKey,
            (job) => job && mapCondition(job, conditionId, (c) => withTypedComments(c, body)),
          );
        }
        banners.show("stale", MESSAGES.stale);
      } else {
        banners.show("save-failed", saveFailedText(error instanceof ApiProblem ? error.requestId : undefined));
      }
    },
    onSuccess: (condition) => {
      // Another edit of this condition is queued behind this one: keep its optimistic fields, take only the new version.
      const queued = pendingWrites() > 1;
      queryClient.setQueryData<JobDetail>(
        queryKey,
        (job) =>
          job &&
          mapCondition(job, conditionId, (c) =>
            queued ? { ...c, version: condition.version, updatedAt: condition.updatedAt } : condition,
          ),
      );
      if (!queued) void refreshJob(queryClient);
    },
  });
}
