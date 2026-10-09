"use client";
import type { FileMeta, JobDetail } from "@kr/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { api, ApiProblem, queryKeys } from "@/lib/api";
import { useBanners } from "@/lib/banner/BannerProvider";
import { saveFailedText } from "@/lib/messages";
import { mapCheckpoint } from "./cache";
import { refreshJob } from "./refreshJob";

export interface UseDeleteFile {
  /** Remove a file (the card has asked "Remove? Yes / No" already). It leaves the list at once and comes back on failure. */
  readonly remove: (file: FileMeta) => Promise<void>;
  /** Ids being removed right now. */
  readonly removing: ReadonlySet<string>;
}

/** How a file leaves a list of files in the cached job, and how it comes back when the removal fails. */
export interface FileListEdit {
  readonly without: (job: JobDetail, file: FileMeta) => JobDetail;
  readonly restore: (job: JobDetail, file: FileMeta) => JobDetail;
}

function checkpointFiles(checkpointKey: string): FileListEdit {
  return {
    without: (job, file) =>
      mapCheckpoint(job, checkpointKey, (c) => ({ ...c, files: c.files.filter((f) => f.id !== file.id) })),
    restore: (job, file) =>
      mapCheckpoint(job, checkpointKey, (c) =>
        c.files.some((f) => f.id === file.id) ? c : { ...c, files: [...c.files, file] },
      ),
  };
}

/**
 * `deleteFile` for a file of a checkpoint (§5.5), or of another list of the job when `from` says how the cached job changes
 * (a condition's evidence, §5.6; the caller keeps `from` the same object between renders). A file someone else already
 * removed (404) just disappears.
 */
export function useDeleteFile(jobId: string, from: string | FileListEdit): UseDeleteFile {
  const queryClient = useQueryClient();
  const banners = useBanners();
  const [removing, setRemoving] = useState<ReadonlySet<string>>(new Set());

  const edit = useMemo(() => (typeof from === "string" ? checkpointFiles(from) : from), [from]);

  const remove = useCallback(
    async (file: FileMeta) => {
      const queryKey = queryKeys.jobs.detail(jobId);
      setRemoving((ids) => new Set(ids).add(file.id));
      queryClient.setQueryData<JobDetail>(queryKey, (job) => job && edit.without(job, file));
      try {
        await api("deleteFile", { params: { fileId: file.id } });
      } catch (error) {
        if (!(error instanceof ApiProblem && error.status === 404)) {
          queryClient.setQueryData<JobDetail>(queryKey, (job) => job && edit.restore(job, file));
          banners.show("save-failed", saveFailedText(error instanceof ApiProblem ? error.requestId : undefined));
        }
      } finally {
        setRemoving((ids) => {
          const next = new Set(ids);
          next.delete(file.id);
          return next;
        });
        void refreshJob(queryClient);
      }
    },
    [banners, edit, jobId, queryClient],
  );

  return { remove, removing };
}
