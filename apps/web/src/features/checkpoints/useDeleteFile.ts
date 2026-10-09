"use client";
import type { FileMeta, JobDetail } from "@kr/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
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

/** `deleteFile` for a file of a checkpoint (§5.5). A file someone else already removed (404) just disappears. */
export function useDeleteFile(jobId: string, checkpointKey: string): UseDeleteFile {
  const queryClient = useQueryClient();
  const banners = useBanners();
  const [removing, setRemoving] = useState<ReadonlySet<string>>(new Set());

  const remove = useCallback(
    async (file: FileMeta) => {
      const queryKey = queryKeys.jobs.detail(jobId);
      const without = (job: JobDetail) =>
        mapCheckpoint(job, checkpointKey, (c) => ({ ...c, files: c.files.filter((f) => f.id !== file.id) }));
      setRemoving((ids) => new Set(ids).add(file.id));
      queryClient.setQueryData<JobDetail>(queryKey, (job) => job && without(job));
      try {
        await api("deleteFile", { params: { fileId: file.id } });
      } catch (error) {
        if (!(error instanceof ApiProblem && error.status === 404)) {
          queryClient.setQueryData<JobDetail>(
            queryKey,
            (job) =>
              job &&
              mapCheckpoint(job, checkpointKey, (c) =>
                c.files.some((f) => f.id === file.id) ? c : { ...c, files: [...c.files, file] },
              ),
          );
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
    [banners, checkpointKey, jobId, queryClient],
  );

  return { remove, removing };
}
