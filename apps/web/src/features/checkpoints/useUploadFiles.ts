"use client";
import type { JobDetail } from "@kr/contracts";
import type { SlotDefinition } from "@kr/workflow";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { queryKeys, uploadFile, type UploadedFile } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useToast } from "@/lib/toast/ToastProvider";
import { describeAccept } from "./accept";
import { mapCheckpoint } from "./cache";
import { uploadedText } from "./messages";
import { refreshJob } from "./refreshJob";
import { uploadErrorText } from "./uploadErrors";

export interface UploadProgress {
  readonly name: string;
  /** Bytes sent of the current file, 0..1. */
  readonly fraction: number;
}

export interface UseUploadFiles {
  /** Send the files one after the other. Resolves with the ones that were stored; refused ones go to `errors`. */
  readonly upload: (files: readonly File[]) => Promise<readonly UploadedFile[]>;
  readonly busy: boolean;
  readonly progress: UploadProgress | null;
  /** One line per refused file of the last upload, for the list under the card. */
  readonly errors: readonly string[];
}

export interface UseUploadFilesOptions {
  readonly jobId: string;
  readonly checkpointKey: string;
  readonly slot: Pick<SlotDefinition, "key" | "accept">;
}

/**
 * Upload files into a checkpoint slot (§5.5): one request per file with progress and its own Idempotency-Key. A stored file
 * shows in the card at once (scanning), the job is refreshed afterwards, and a refused file is listed with its reason
 * (too large, wrong type, …) while the others still go through.
 */
export function useUploadFiles({ jobId, checkpointKey, slot }: UseUploadFilesOptions): UseUploadFiles {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { uploadMaxBytes } = useSession();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [errors, setErrors] = useState<readonly string[]>([]);
  const { key: slotKey, accept } = slot;

  const upload = useCallback(
    async (files: readonly File[]) => {
      const stored: UploadedFile[] = [];
      const refused: string[] = [];
      setBusy(true);
      setErrors([]);
      for (const file of files) {
        setProgress({ name: file.name, fraction: 0 });
        try {
          const result = await uploadFile({
            jobId,
            file,
            checkpointKey,
            slot: slotKey,
            idempotencyKey: crypto.randomUUID(),
            onProgress: (fraction) => {
              setProgress({ name: file.name, fraction });
            },
          });
          stored.push(result);
          queryClient.setQueryData<JobDetail>(
            queryKeys.jobs.detail(jobId),
            (job) =>
              job &&
              mapCheckpoint(job, checkpointKey, (c) =>
                c.files.some((f) => f.id === result.file.id) ? c : { ...c, files: [...c.files, result.file] },
              ),
          );
        } catch (error) {
          refused.push(
            uploadErrorText(file.name, error, { acceptDescription: describeAccept(accept), maxBytes: uploadMaxBytes }),
          );
        }
      }
      setBusy(false);
      setProgress(null);
      setErrors(refused);
      if (stored.length > 0) {
        toast(uploadedText(stored.length));
        void refreshJob(queryClient);
      }
      return stored;
    },
    [jobId, checkpointKey, slotKey, accept, queryClient, toast, uploadMaxBytes],
  );

  return { upload, busy, progress, errors };
}
