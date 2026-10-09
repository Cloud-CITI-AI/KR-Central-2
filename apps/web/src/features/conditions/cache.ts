import type { Condition, JobDetail, UpdateConditionRequest } from "@kr/contracts";
import type { z } from "zod";

export type UpdateConditionBody = z.output<typeof UpdateConditionRequest>;

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
