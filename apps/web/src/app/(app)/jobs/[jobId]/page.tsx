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
 * API, which this asks before rendering so the response itself is a 404 (the tracker would only find out in the browser).
 */
export default async function JobPage({ params, searchParams }: JobPageProps) {
  const { jobId } = await params;
  if (!Uuid.safeParse(jobId).success) notFound();
  if (!(await getJobSummary(jobId))) notFound();
  const { stage } = await searchParams;
  const requested = Array.isArray(stage) ? stage[0] : stage;
  return <TrackerPage jobId={jobId} {...(isStageKey(requested) ? { initialStage: requested } : {})} />;
}
