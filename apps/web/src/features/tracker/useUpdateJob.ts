"use client";
import type { JobDetail, UpdateJobRequest } from "@kr/contracts";
import { outcomeDateFor } from "@kr/workflow";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { z } from "zod";
import { api, ApiProblem, queryKeys } from "@/lib/api";
import { useBanners } from "@/lib/banner/BannerProvider";
import { MESSAGES, saveFailedText } from "@/lib/messages";

export type UpdateJobBody = z.output<typeof UpdateJobRequest>;

/** Show an edit at once, the way the API will answer it: a manual conformed date resets the outcome date to +90 days (R10). */
export function applyJobEdit(job: JobDetail, body: UpdateJobBody): JobDetail {
  const { conformedDate, ...rest } = body;
  const sent = Object.entries(rest).filter(([, value]) => value !== undefined);
  const edited: JobDetail = { ...job, ...(Object.fromEntries(sent) as Partial<JobDetail>) };
  if (conformedDate === undefined) return edited;
  return {
    ...edited,
    conformedDate,
    conformedSource: conformedDate === null ? null : { method: "manual", fileName: null, stampText: null },
    outcomeDate:
      body.outcomeDate === undefined && conformedDate !== null ? outcomeDateFor(conformedDate) : edited.outcomeDate,
  };
}

/**
 * `updateJob` with `If-Match` (§5.1, §14): optimistic, one write at a time per job so the next one carries the version the
 * last one produced. 412 reloads the job and shows the stale banner; 409 (job number in use) is left to the caller to show
 * next to the field; any other failure rolls back and shows the save-failed banner.
 */
export function useUpdateJob(jobId: string) {
  const queryClient = useQueryClient();
  const banners = useBanners();
  const queryKey = queryKeys.jobs.detail(jobId);
  return useMutation<JobDetail, Error, UpdateJobBody, { previous: JobDetail | undefined }>({
    scope: { id: `job-${jobId}` },
    mutationFn: (body) => {
      const current = queryClient.getQueryData<JobDetail>(queryKey);
      if (!current) throw new Error("Nothing loaded to change");
      return api("updateJob", { params: { jobId }, body, ifMatch: current.version });
    },
    onMutate: async (body) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<JobDetail>(queryKey);
      if (previous) queryClient.setQueryData(queryKey, applyJobEdit(previous, body));
      return { previous };
    },
    onError: async (error, _body, context) => {
      if (context?.previous) queryClient.setQueryData(queryKey, context.previous);
      if (error instanceof ApiProblem && error.status === 409) return;
      if (error instanceof ApiProblem && error.isStale) {
        await queryClient.refetchQueries({ queryKey });
        banners.show("stale", MESSAGES.stale);
      } else {
        banners.show("save-failed", saveFailedText(error instanceof ApiProblem ? error.requestId : undefined));
      }
    },
    onSuccess: (job) => {
      queryClient.setQueryData(queryKey, job);
      // the picker and the dashboard show the job number, address and client
      void queryClient.invalidateQueries({
        queryKey: queryKeys.jobs.all,
        predicate: (q) => q.queryKey[1] !== "detail",
      });
    },
  });
}
