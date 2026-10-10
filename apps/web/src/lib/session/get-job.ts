import { JobDetail } from "@kr/contracts";
import { redirect } from "next/navigation";
import { cache } from "react";
import type { z } from "zod";
import { signInHref } from "@/lib/api/client";
import { problemFromResponse } from "@/lib/api/problem";
import { fetchUpstream } from "./upstream";

/** What the page itself needs of a job (title, existence); the tracker loads the whole job in the browser. */
const JobSummary = JobDetail.pick({ id: true, jobNumber: true, address: true });
export type JobSummary = z.output<typeof JobSummary>;

/**
 * Server-side `GET /v1/jobs/{jobId}` for the job page, so a job that is missing, archived or not the caller's (all 404 from the
 * API) is a 404 response before anything streams, and the page title can name the job. Null for 404; 401 redirects to
 * sign-in. Memoised per request, so `generateMetadata` and the page share one call.
 */
export const getJobSummary = cache(async (jobId: string): Promise<JobSummary | null> => {
  const { response, returnTo } = await fetchUpstream(`/v1/jobs/${encodeURIComponent(jobId)}`);
  if (response.status === 404) return null;
  if (response.status === 401) redirect(signInHref(returnTo));
  if (!response.ok) throw await problemFromResponse(response);
  return JobSummary.parse(await response.json());
});
