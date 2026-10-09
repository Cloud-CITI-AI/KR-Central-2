"use client";
import type { FileMeta, JobDetail } from "@kr/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, queryKeys } from "@/lib/api";
import { useToast } from "@/lib/toast/ToastProvider";
import { mapCheckpoint } from "./cache";
import { refreshJob } from "./refreshJob";

/**
 * `pasteEmail` (§5.5, 4.3): plain text dropped on the emails zone becomes a stored email. It shows in the list at once; the
 * job is refreshed afterwards. The zone words a failure itself (it knows the request id), so no banner here.
 */
export function usePasteEmail(jobId: string, checkpointKey: string) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation<FileMeta, Error, string>({
    mutationFn: (text) => api("pasteEmail", { params: { jobId }, body: { text }, idempotencyKey: crypto.randomUUID() }),
    onSuccess: (file) => {
      queryClient.setQueryData<JobDetail>(
        queryKeys.jobs.detail(jobId),
        (job) =>
          job &&
          mapCheckpoint(job, checkpointKey, (c) =>
            c.files.some((f) => f.id === file.id) ? c : { ...c, files: [...c.files, file] },
          ),
      );
      toast("Email added");
      void refreshJob(queryClient);
    },
  });
}
