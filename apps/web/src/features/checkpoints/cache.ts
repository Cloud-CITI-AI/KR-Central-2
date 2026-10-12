import type { CheckpointState, JobDetail, UpdateCheckpointRequest } from "@kr/contracts";
import { STAGES, effectiveState, isJobComplete, summariseProgress, summariseStage } from "@kr/workflow";
import type { z } from "zod";

export type UpdateCheckpointBody = z.output<typeof UpdateCheckpointRequest>;
/** A checkpoint edit; `baseVersion` is the version a typed note was started over (sent as If-Match instead of the cached one). */
export type UpdateCheckpointVars = UpdateCheckpointBody & { readonly baseVersion?: number | undefined };

/** `job` with the checkpoint `key` replaced by `change(checkpoint)`; every other checkpoint stays the same object. */
export function mapCheckpoint(
  job: JobDetail,
  key: string,
  change: (checkpoint: CheckpointState) => CheckpointState,
): JobDetail {
  return { ...job, checkpoints: job.checkpoints.map((c) => (c.key === key ? change(c) : c)) };
}

/** Recompute the progress ring, stage bars and the complete flag from the checkpoints, as the API does. */
function withSummary(job: JobDetail): JobDetail {
  const input = {
    states: Object.fromEntries(
      job.checkpoints.map((c) => [c.key, { status: c.storedStatus, responsibility: c.responsibility }]),
    ),
    conditions: job.conditions,
  };
  return {
    ...job,
    summary: {
      ...job.summary,
      progress: summariseProgress(input),
      stages: STAGES.map((stage) => summariseStage(stage, input)),
      isComplete: isJobComplete(input),
    },
  };
}

/**
 * Show a status, responsibility or KR note edit at once, the way the API will answer it. The version stays: the server's
 * answer replaces it, and the next write sends it as If-Match.
 */
export function applyCheckpointEdit(job: JobDetail, key: string, body: UpdateCheckpointBody): JobDetail {
  const edited = mapCheckpoint(job, key, (c) => {
    const storedStatus = body.status ?? c.storedStatus;
    const responsibility = body.responsibility === undefined ? c.responsibility : body.responsibility;
    const states = { [key]: { status: storedStatus, responsibility } };
    const { status } = effectiveState(key, { states, conditions: job.conditions });
    return { ...c, storedStatus, status, responsibility, krNote: body.krNote ?? c.krNote };
  });
  return body.status === undefined ? edited : withSummary(edited);
}
