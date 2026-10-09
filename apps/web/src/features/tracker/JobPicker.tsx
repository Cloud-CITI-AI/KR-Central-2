"use client";
import type { JobCard, JobDetail } from "@kr/contracts";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useId } from "react";
import { Select } from "@/components/ui/Select";
import { api, queryKeys } from "@/lib/api";
import { groupPickerJobs } from "./pickerGroups";
import styles from "./Jobbar.module.css";

export interface JobPickerProps {
  readonly job: JobDetail;
}

const PAGE_SIZE = 100;
/** Designed for ≤ 2,000 active jobs (§14); the cap only stops a runaway cursor. */
const MAX_JOBS = 5000;

async function fetchAllJobs(signal: AbortSignal): Promise<JobCard[]> {
  const jobs: JobCard[] = [];
  let cursor: string | undefined;
  do {
    const page = await api("listJobs", {
      query: { status: "all", sort: "job_number", limit: PAGE_SIZE, ...(cursor ? { cursor } : {}) },
      signal,
    });
    jobs.push(...page.items);
    cursor = page.nextCursor ?? undefined;
  } while (cursor && jobs.length < MAX_JOBS);
  return jobs;
}

/** Label "JOB" and the job picker (§4, §5.1): choosing a job opens its tracker. */
export function JobPicker({ job }: JobPickerProps) {
  const router = useRouter();
  const selectId = useId();
  const jobs = useQuery({
    queryKey: queryKeys.jobs.list({ picker: true }),
    queryFn: ({ signal }) => fetchAllJobs(signal),
    staleTime: 60_000,
    refetchInterval: false,
    refetchOnWindowFocus: false,
  });
  const groups = groupPickerJobs(jobs.data ?? [], job);
  return (
    <>
      <label htmlFor={selectId} className={styles.label}>
        Job
      </label>
      <Select
        id={selectId}
        className={styles.picker}
        value={job.id}
        onChange={(event) => {
          if (event.target.value !== job.id) router.push(`/jobs/${event.target.value}`);
        }}
      >
        {groups.map((group) => (
          <optgroup key={group.label} label={group.label}>
            {group.entries.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.text}
              </option>
            ))}
          </optgroup>
        ))}
      </Select>
    </>
  );
}
