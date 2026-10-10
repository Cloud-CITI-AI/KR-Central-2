"use client";
import type { JobCard } from "@kr/contracts";
import { useQuery } from "@tanstack/react-query";
import { api, queryKeys } from "@/lib/api";
import { isUuid } from "@/lib/uuid";
import { useDebouncedValue } from "./useDebouncedValue";

export interface JobLookup {
  /** Jobs whose number, address or client match the text (up to 20, any status). */
  readonly options: readonly JobCard[];
  /** The job the text names: a job number from `options`, or a job id pasted in. Undefined while it names none. */
  readonly jobId: string | undefined;
}

/** Turns what is typed into the audit "Job" filter into a job id, suggesting jobs as the person types (job picker order). */
export function useJobLookup(text: string): JobLookup {
  const typed = text.trim();
  const q = useDebouncedValue(typed);
  const { data } = useQuery({
    queryKey: queryKeys.jobs.list({ picker: "audit", q }),
    queryFn: ({ signal }) =>
      api("listJobs", { query: { status: "all", sort: "job_number", limit: 20, ...(q ? { q } : {}) }, signal }),
  });
  const options = data?.items ?? [];
  const match = options.find((job) => job.jobNumber.toLowerCase() === typed.toLowerCase());
  return { options, jobId: match?.id ?? (isUuid(typed) ? typed : undefined) };
}
