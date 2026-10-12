import type { Condition, FileMeta, JobDetail, UpdateConditionRequest } from "@kr/contracts";
import type { z } from "zod";

export type UpdateConditionBody = z.output<typeof UpdateConditionRequest>;
/** A condition edit; `baseVersion` is the version a typed comment was started over (sent as If-Match instead of the cached one). */
export type UpdateConditionVars = UpdateConditionBody & { readonly baseVersion?: number | undefined };

/** `job` with the condition `id` replaced by `change(condition)`; every other condition stays the same object. */
export function mapCondition(job: JobDetail, id: string, change: (condition: Condition) => Condition): JobDetail {
  return { ...job, conditions: job.conditions.map((c) => (c.id === id ? change(c) : c)) };
}

/**
 * Show a tick, responsibility, agency or comment edit at once, the way the API will answer it: choosing an agency or
 * confirming the guess ends "agency guessed". The version stays: the server's answer replaces it, and the next write sends it
 * as If-Match. What an agency change does to the stage bars comes with the refresh that follows the write.
 */
export function applyConditionEdit(job: JobDetail, id: string, body: UpdateConditionBody): JobDetail {
  return mapCondition(job, id, (c) => ({
    ...c,
    isCleared: body.isCleared ?? c.isCleared,
    responsibility: body.responsibility === undefined ? c.responsibility : body.responsibility,
    agency: body.agency ?? c.agency,
    agencyGuessed: body.agency !== undefined || body.agencyConfirmed === true ? false : c.agencyGuessed,
    krComment: body.krComment ?? c.krComment,
    clientComment: body.clientComment ?? c.clientComment,
  }));
}

/** `job` with `file` among the evidence of condition `id` (unchanged when it is there already). */
export function withEvidence(job: JobDetail, id: string, file: FileMeta): JobDetail {
  return mapCondition(job, id, (c) =>
    c.evidence.some((f) => f.id === file.id) ? c : { ...c, evidence: [...c.evidence, file] },
  );
}

/** `job` without `file` among the evidence of condition `id`. */
export function withoutEvidence(job: JobDetail, id: string, file: FileMeta): JobDetail {
  return mapCondition(job, id, (c) => ({ ...c, evidence: c.evidence.filter((f) => f.id !== file.id) }));
}
