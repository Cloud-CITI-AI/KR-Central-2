import { Uuid } from "@kr/contracts";
import { STAGE_KEYS, type StageKey } from "@kr/workflow";
import { notFound } from "next/navigation";
import { TrackerPage } from "@/features/tracker";

interface JobPageProps {
  readonly params: Promise<{ readonly jobId: string }>;
  readonly searchParams: Promise<{ readonly stage?: string | string[] }>;
}

const isStageKey = (value: unknown): value is StageKey => (STAGE_KEYS as readonly unknown[]).includes(value);

/**
 * The tracker for one job (§4, §5). `?stage=<stageKey>` opens and scrolls to a stage; an id that is not a UUID can never
 * be a job, so it is a 404 without asking the API. A job the person may not see is a 404 from the API (see TrackerPage).
 */
export default async function JobPage({ params, searchParams }: JobPageProps) {
  const { jobId } = await params;
  if (!Uuid.safeParse(jobId).success) notFound();
  const { stage } = await searchParams;
  const requested = Array.isArray(stage) ? stage[0] : stage;
  return <TrackerPage jobId={jobId} {...(isStageKey(requested) ? { initialStage: requested } : {})} />;
}
