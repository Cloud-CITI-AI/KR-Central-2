"use client";
import type { ActiveOperation, JobDetail } from "@kr/contracts";
import { useState } from "react";

/**
 * The id of a reading of `type` that the job says is queued or running (`JobDetail.activeOperations`) and that this page did not
 * start itself, so a reload (or a second tab, or a refused duplicate start) goes on showing "Reading…" and polls it to its result.
 * Once it ends and the job is refetched without it, the id is kept, so the result stays on screen; `null` while `ownsOperation`
 * says the panel is following one it started.
 */
export function useResumedOperation(
  job: JobDetail,
  type: ActiveOperation["type"],
  ownsOperation: boolean,
): string | null {
  const active = job.activeOperations.find((operation) => operation.type === type)?.id ?? null;
  const [latched, setLatched] = useState<string | null>(null);
  // Adjusting state while rendering (not in an effect) keeps the id in the very render that first sees it.
  if (active !== null && !ownsOperation && latched !== active) setLatched(active);
  return ownsOperation ? null : (active ?? latched);
}
