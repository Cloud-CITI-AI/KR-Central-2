import type { UploadResult } from "@kr/contracts";
import type { z } from "zod";
import { apiPath, redirectToSignIn } from "./client";
import { getCsrfToken } from "./csrf";
import { networkProblem, problemFromResponse } from "./problem";

export type UploadedFile = z.output<typeof UploadResult>;

export interface UploadFileOptions {
  readonly jobId: string;
  readonly file: File;
  /** Either `checkpointKey` + `slot`, or `conditionId` (contract UploadFields). */
  readonly checkpointKey?: string;
  readonly slot?: string;
  readonly conditionId?: string;
  readonly idempotencyKey?: string;
  /** Bytes sent so far as a fraction, 0..1. */
  readonly onProgress?: (fraction: number) => void;
  readonly signal?: AbortSignal;
}

/**
 * Multipart upload with progress and abort (fetch cannot report upload progress). Text fields go before the single
 * `file` part (contract). Resolves with the stored file (scan pending) and any follow-up operation.
 */
export function uploadFile(options: UploadFileOptions): Promise<UploadedFile> {
  const { jobId, file, checkpointKey, slot, conditionId, idempotencyKey, onProgress, signal } = options;
  return new Promise<UploadedFile>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Upload aborted", "AbortError"));
      return;
    }
    const form = new FormData();
    for (const [name, value] of Object.entries({ checkpointKey, slot, conditionId })) {
      if (value !== undefined) form.append(name, value);
    }
    form.append("file", file, file.name);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", apiPath("uploadFile", { jobId }));
    xhr.setRequestHeader("accept", "application/json");
    xhr.setRequestHeader("idempotency-key", idempotencyKey ?? crypto.randomUUID());
    const csrf = getCsrfToken();
    if (csrf) xhr.setRequestHeader("x-csrf-token", csrf);

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) onProgress?.(event.loaded / event.total);
    };
    xhr.onerror = () => {
      reject(networkProblem());
    };
    xhr.onabort = () => {
      reject(new DOMException("Upload aborted", "AbortError"));
    };
    xhr.onload = () => {
      const response = new Response(xhr.status === 204 ? null : xhr.responseText, {
        status: xhr.status,
        headers: { "x-request-id": xhr.getResponseHeader("x-request-id") ?? "" },
      });
      if (xhr.status >= 200 && xhr.status < 300) {
        response
          .json()
          .then(async (json: unknown) => (await import("./validate")).parseUploadResult(json))
          .then(resolve, reject);
        return;
      }
      void problemFromResponse(response).then((problem) => {
        if (problem.status === 401) redirectToSignIn();
        reject(problem);
      });
    };
    signal?.addEventListener("abort", () => {
      xhr.abort();
    });
    xhr.send(form);
  });
}
