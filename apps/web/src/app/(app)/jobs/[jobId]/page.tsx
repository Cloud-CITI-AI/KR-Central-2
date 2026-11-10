import { Uuid } from "@kr/contracts";
import { STAGE_KEYS, type StageKey } from "@kr/workflow";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TrackerPage } from "@/features/tracker";
import { getJobSummary } from "@/lib/session/get-job";

interface JobPageProps {
  readonly params: Promise<{ readonly jobId: string }>;
  readonly searchParams: Promise<{ readonly stage?: string | string[] }>;
}

const isStageKey = (value: unknown): value is StageKey => (STAGE_KEYS as readonly unknown[]).includes(value);

const NOT_FOUND: Metadata = { title: "Page not found" };

/** "P-0001 – 1 Example Street" (WCAG 2.4.2): the job number and address, or the not-found title for a job that cannot be shown. */
export async function generateMetadata({ params }: Pick<JobPageProps, "params">): Promise<Metadata> {
  const { jobId } = await params;
  if (!Uuid.safeParse(jobId).success) return NOT_FOUND;
  const job = await getJobSummary(jobId);
  return job ? { title: `${job.jobNumber} – ${job.address}` } : NOT_FOUND;
}

/**
 * The tracker for one job (§4, §5). `?stage=<stageKey>` opens and scrolls to a stage; an id that is not a UUID can never
 * be a job, so it is a 404 without asking the API. A job that is missing, archived or not the person's is a 404 from the
 * API, which this asks before rendering so the response itself is a 404. What it learns of the job (number, address,
 * client, type) goes to the tracker as its heading, so the page's largest content is in the first HTML (LCP); the
 * interactive body still loads in the browser, behind its skeleton, and only appears once it can be used.
 */
export default async function JobPage({ params, searchParams }: JobPageProps) {
  const { jobId } = await params;
  if (!Uuid.safeParse(jobId).success) notFound();
  const job = await getJobSummary(jobId);
  if (!job) notFound();
  const { stage } = await searchParams;
  const requested = Array.isArray(stage) ? stage[0] : stage;
  const heading = {
    jobNumber: job.jobNumber,
    address: job.address,
    clientName: job.clientName ?? null,
    subdivisionType: job.subdivisionType ?? null,
    isComplete: job.summary?.isComplete ?? false,
  };
  return (
    <TrackerPage jobId={jobId} heading={heading} {...(isStageKey(requested) ? { initialStage: requested } : {})} />
  );
}
