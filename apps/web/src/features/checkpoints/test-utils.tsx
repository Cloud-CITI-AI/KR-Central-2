import type { CheckpointState, JobDetail } from "@kr/contracts";
import { getCheckpoint } from "@kr/workflow";
import { HttpResponse } from "msw";
import type { ReactElement } from "react";
import { BannerRegion } from "@/components/ui/BannerRegion";
import { ToastRegion } from "@/components/ui/ToastRegion";
import { queryKeys } from "@/lib/api";
import { syntheticMe } from "@/test/fixtures";
import { handlerFor, mockApi } from "@/test/msw/handlers";
import { server } from "@/test/msw/server";
import { createTestQueryClient, renderWithProviders, type RenderWithProvidersOptions } from "@/test/render";
import { useJob } from "@/features/tracker";
import { CheckpointCard } from "./CheckpointCard";

interface HarnessProps {
  readonly jobId: string;
  readonly checkpointKey: string;
}

/** What the tracker does: the card gets the job from the shared query, so a cache write shows at once. */
function Harness({ jobId, checkpointKey }: HarnessProps) {
  const { data: job } = useJob(jobId);
  const checkpoint = job?.checkpoints.find((c) => c.key === checkpointKey);
  return job && checkpoint ? (
    <CheckpointCard job={job} checkpoint={checkpoint} definition={getCheckpoint(checkpointKey)} />
  ) : null;
}

/**
 * Render `ui` the way the tracker renders cards. The job is seeded in the cache and `getJob` answers with `served.job`, so a
 * test can change what the "server" returns before the page refetches.
 */
export function renderWithJob(
  ui: ReactElement,
  job: JobDetail,
  { me = syntheticMe(), ...options }: RenderWithProvidersOptions = {},
) {
  const queryClient = createTestQueryClient();
  queryClient.setQueryData(queryKeys.jobs.detail(job.id), job);
  const served = { job };
  server.use(
    mockApi("getMe", me),
    handlerFor("getJob", () => HttpResponse.json(served.job)),
  );
  const view = renderWithProviders(
    <>
      <BannerRegion />
      <ToastRegion />
      {ui}
    </>,
    { me, queryClient, ...options },
  );
  return { ...view, served };
}

/** Render one checkpoint card the way the tracker does. */
export function renderCard(job: JobDetail, checkpointKey: string, options: RenderWithProvidersOptions = {}) {
  return renderWithJob(<Harness jobId={job.id} checkpointKey={checkpointKey} />, job, options);
}

/** The checkpoint `key` of `job`. */
export function checkpointOf(job: JobDetail, key: string): CheckpointState {
  const found = job.checkpoints.find((c) => c.key === key);
  if (!found) throw new Error(`No checkpoint ${key}`);
  return found;
}

/** `job` with the checkpoint `key` changed by `patch`: what the "server" holds after a write, or a seeded state. */
export function withCheckpoint(job: JobDetail, key: string, patch: Partial<CheckpointState>): JobDetail {
  return { ...job, checkpoints: job.checkpoints.map((c) => (c.key === key ? { ...c, ...patch } : c)) };
}
