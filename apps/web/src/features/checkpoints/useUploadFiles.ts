"use client";
import type { FileMeta, JobDetail } from "@kr/contracts";
import type { FileKind, SlotDefinition } from "@kr/workflow";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { queryKeys, uploadFile, type UploadedFile } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useToast } from "@/lib/toast/ToastProvider";
import { describeAccept } from "./accept";
import { mapCheckpoint } from "./cache";
import { uploadedText } from "./messages";
import { refreshJob } from "./refreshJob";
import { useFollowedOperations } from "./useFollowedOperation";
import { uploadErrorText } from "./uploadErrors";

/** How many queued operations of earlier uploads stay followed (settled ones cost nothing; this only bounds the list). */
const MAX_FOLLOWED = 20;

export interface UploadProgress {
  readonly name: string;
  /** Bytes sent of the current file, 0..1. */
  readonly fraction: number;
}

/** `job` with `file` added to the slot's files of the checkpoint (and unchanged when it is there already). */
function addToSlot(checkpointKey: string) {
  return (job: JobDetail, file: FileMeta): JobDetail =>
    mapCheckpoint(job, checkpointKey, (c) =>
      c.files.some((f) => f.id === file.id) ? c : { ...c, files: [...c.files, file] },
    );
}

export interface UseUploadFiles {
  /** Send the files one after the other. Resolves with the ones that were stored; refused ones go to `errors`. */
  readonly upload: (files: readonly File[]) => Promise<readonly UploadedFile[]>;
  readonly busy: boolean;
  readonly progress: UploadProgress | null;
  /** One line per refused file of the last upload, for the list under the card. */
  readonly errors: readonly string[];
}

interface UploadFilesBase {
  readonly jobId: string;
}

/** Files of a checkpoint's slot. */
export interface CheckpointUploadTarget extends UploadFilesBase {
  readonly checkpointKey: string;
  readonly slot: Pick<SlotDefinition, "key" | "accept">;
}

/** Files of one condition's evidence: the caller says which kinds it takes and how a stored file joins the cached job. */
export interface ConditionUploadTarget extends UploadFilesBase {
  readonly conditionId: string;
  readonly accept: readonly FileKind[];
  /** `job` with `file` added to the condition's evidence (and unchanged when it is there already). */
  readonly addFile: (job: JobDetail, file: FileMeta) => JobDetail;
}

export type UseUploadFilesOptions = CheckpointUploadTarget | ConditionUploadTarget;

/**
 * Upload files into a checkpoint slot or a condition's evidence (§5.5, §5.6): one request per file with progress and its own
 * Idempotency-Key. A stored file shows in the card at once (scanning), the job is refreshed afterwards and again when the
 * operation each upload queued (the scan) settles, and a refused file is listed with its reason (too large, wrong type, …) while the others still go through.
 */
export function useUploadFiles(options: UseUploadFilesOptions): UseUploadFiles {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { uploadMaxBytes } = useSession();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [errors, setErrors] = useState<readonly string[]>([]);
  // The operations the uploads queued (the scan, or the read/parse when scanning is off): followed until they settle, then
  // the job is refreshed, so a scanned file shows as clean at once and not at the next periodic refetch (§10).
  const [followed, setFollowed] = useState<readonly string[]>([]);
  useFollowedOperations(followed);

  const upload = useCallback(
    async (files: readonly File[]) => {
      const { jobId } = options;
      const accept = "slot" in options ? options.slot.accept : options.accept;
      const fields =
        "slot" in options
          ? { checkpointKey: options.checkpointKey, slot: options.slot.key }
          : { conditionId: options.conditionId };
      const place = "slot" in options ? addToSlot(options.checkpointKey) : options.addFile;
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
            ...fields,
            idempotencyKey: crypto.randomUUID(),
            onProgress: (fraction) => {
              setProgress({ name: file.name, fraction });
            },
          });
          stored.push(result);
          queryClient.setQueryData<JobDetail>(queryKeys.jobs.detail(jobId), (job) => job && place(job, result.file));
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
        const queued = stored.flatMap((result) => (result.operation ? [result.operation.id] : []));
        if (queued.length > 0) setFollowed((previous) => [...previous.slice(-MAX_FOLLOWED), ...queued]);
        toast(uploadedText(stored.length));
        void refreshJob(queryClient);
      }
      return stored;
    },
    [options, queryClient, toast, uploadMaxBytes],
  );

  return { upload, busy, progress, errors };
}
