"use client";
import type { Operation } from "@kr/contracts";
import { useMutation } from "@tanstack/react-query";
import { api } from "@/lib/api";

export interface StartConditionsExtractionVars {
  readonly fileId: string;
  /** True once the person has confirmed the replacement (§5.5); the API answers 409 without it when conditions exist. */
  readonly replaceExisting: boolean;
}

/**
 * `startConditionsExtraction` (§10.2): read the numbered conditions of a Decision Letter. Answers with the queued operation.
 * Every start has its own `Idempotency-Key`: the retry with `replaceExisting` is a different request and must not replay the 409.
 */
export function useStartConditionsExtraction(jobId: string) {
  return useMutation<Operation, Error, StartConditionsExtractionVars>({
    mutationFn: (body) =>
      api("startConditionsExtraction", { params: { jobId }, body, idempotencyKey: crypto.randomUUID() }),
  });
}
