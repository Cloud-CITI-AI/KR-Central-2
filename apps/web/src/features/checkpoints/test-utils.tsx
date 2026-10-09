import type { JobDetail } from "@kr/contracts";
import { getCheckpoint } from "@kr/workflow";
import { HttpResponse } from "msw";
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
 * Render one checkpoint card the way the tracker does. The job is seeded in the cache and `getJob` answers with
 * `served.job`, so a test can change what the "server" returns before the card refetches.
 */
export function renderCard(
  job: JobDetail,
  checkpointKey: string,
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
      <Harness jobId={job.id} checkpointKey={checkpointKey} />
    </>,
    { me, queryClient, ...options },
  );
  return { ...view, served };
}
