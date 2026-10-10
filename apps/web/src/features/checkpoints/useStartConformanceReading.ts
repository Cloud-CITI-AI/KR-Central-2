"use client";
import type { Operation } from "@kr/contracts";
import { useMutation } from "@tanstack/react-query";
import { api } from "@/lib/api";

/** `startConformanceReading` (§10.1): read the conformed date of a clean Conformance Notification PDF again (own `Idempotency-Key` per start, required by the contract). Answers with the queued operation. */
export function useStartConformanceReading(jobId: string) {
  return useMutation<Operation, Error, string>({
    mutationFn: (fileId) =>
      api("startConformanceReading", { params: { jobId }, body: { fileId }, idempotencyKey: crypto.randomUUID() }),
  });
}
