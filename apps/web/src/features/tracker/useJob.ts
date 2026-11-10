"use client";
import type { JobDetail } from "@kr/contracts";
import { useQuery } from "@tanstack/react-query";
import { api, queryKeys } from "@/lib/api";

/** How long the job the server sent with the page counts as fresh: one refresh cycle (§14). */
const SERVER_JOB_FRESH_MS = 15_000;

/**
 * The full tracker view of one job on `queryKeys.jobs.detail`, shared by every tracker feature so a change in one place
 * shows in the others at once. The app-wide 15 s refresh and refetch-on-focus apply (§14).
 *
 * `initialJob` is the job the server fetched for this page: with it the tracker is in the first HTML and the browser's first
 * render matches it. It counts as fresh for one refresh cycle, so the page is not asked for again while it is still
 * hydrating (an update then would make React discard the server-drawn tracker and draw it again).
 */
export function useJob(jobId: string, initialJob?: JobDetail) {
  return useQuery({
    queryKey: queryKeys.jobs.detail(jobId),
    queryFn: ({ signal }) => api("getJob", { params: { jobId }, signal }),
    ...(initialJob ? { initialData: initialJob, staleTime: SERVER_JOB_FRESH_MS } : {}),
  });
}
