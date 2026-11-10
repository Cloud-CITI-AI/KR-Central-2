import { redirect } from "next/navigation";
import { cache } from "react";
import { z } from "zod";
import { signInHref } from "@/lib/api/client";
import { fetchUpstream, upstreamProblem } from "./upstream";

/**
 * What the page itself needs of a job: its existence, its title, and the heading it draws in the first HTML (number,
 * address, client, type, whether it is complete). Loose on purpose: only these fields are read, so a newer API field or
 * value elsewhere in the job never breaks the page here. The tracker loads the whole job in the browser.
 */
const JobSummary = z.object({
  id: z.string(),
  jobNumber: z.string(),
  address: z.string(),
  clientName: z.string().nullable().optional(),
  subdivisionType: z.string().nullable().optional(),
  summary: z.object({ isComplete: z.boolean() }).optional(),
});
export type JobSummary = z.output<typeof JobSummary>;

/**
 * Server-side `GET /v1/jobs/{jobId}` for the job page, so a job that is missing, archived or not the caller's (all 404 from the
 * API) is a 404 response before anything streams, the page title can name the job, and the job's heading is in the first
 * HTML (it is the page's largest content: LCP). Null for 404; 401 redirects to sign-in. Memoised per request, so
 * `generateMetadata` and the page share one call.
 */
export const getJobSummary = cache(async (jobId: string): Promise<JobSummary | null> => {
  const { response, returnTo, requestId } = await fetchUpstream(`/v1/jobs/${encodeURIComponent(jobId)}`);
  if (response.status === 404) return null;
  if (response.status === 401) redirect(signInHref(returnTo));
  if (!response.ok) throw await upstreamProblem(response, requestId);
  return JobSummary.parse(await response.json());
});
