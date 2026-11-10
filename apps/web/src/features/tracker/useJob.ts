"use client";
import { useQuery } from "@tanstack/react-query";
import { api, queryKeys } from "@/lib/api";

/**
 * The full tracker view of one job on `queryKeys.jobs.detail`, shared by every tracker feature so a change in one place
 * shows in the others at once. The app-wide 15 s refresh and refetch-on-focus apply (§14).
 */
export function useJob(jobId: string) {
  return useQuery({
    queryKey: queryKeys.jobs.detail(jobId),
    queryFn: ({ signal }) => api("getJob", { params: { jobId }, signal }),
  });
}
