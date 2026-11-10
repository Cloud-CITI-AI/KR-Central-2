import { JobDetail } from "@kr/contracts";
import { redirect } from "next/navigation";
import { cache } from "react";
import type { z } from "zod";
import { signInHref } from "@/lib/api/client";
import { fetchUpstream, upstreamProblem } from "./upstream";

/** What the page itself needs of a job (title, existence): the part of the answer that is checked here. */
const JobSummary = JobDetail.pick({ id: true, jobNumber: true, address: true });
export type JobSummary = z.output<typeof JobSummary>;
export type ServerJob = z.output<typeof JobDetail>;

/**
 * Server-side `GET /v1/jobs/{jobId}` for the job page, so a job that is missing, archived or not the caller's (all 404 from the
 * API) is a 404 response before anything streams, the page title can name the job, and the tracker is drawn in the first
 * HTML instead of after the scripts have loaded and asked again (LCP). Null for 404; 401 redirects to sign-in. Memoised per
 * request, so `generateMetadata` and the page share one call.
 */
export const getJobDetail = cache(async (jobId: string): Promise<ServerJob | null> => {
  const { response, returnTo, requestId } = await fetchUpstream(`/v1/jobs/${encodeURIComponent(jobId)}`);
  if (response.status === 404) return null;
  if (response.status === 401) redirect(signInHref(returnTo));
  if (!response.ok) throw await upstreamProblem(response, requestId);
  // The summary is validated; the rest is passed to the tracker as the API sent it, on the same terms as the browser client
  // in production (which does not re-validate responses either), so a newer API field or value never breaks the page here.
  const body: unknown = await response.json();
  JobSummary.parse(body);
  return body as ServerJob;
});

/** The job's number and address for the page title; shares the request with `getJobDetail`. */
export async function getJobSummary(jobId: string): Promise<JobSummary | null> {
  const job = await getJobDetail(jobId);
  return job ? { id: job.id, jobNumber: job.jobNumber, address: job.address } : null;
}
