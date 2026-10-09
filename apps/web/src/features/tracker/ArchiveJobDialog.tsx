"use client";
import type { JobDetail } from "@kr/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { api, ApiProblem, queryKeys } from "@/lib/api";
import { useBanners } from "@/lib/banner/BannerProvider";
import { MESSAGES, saveFailedText } from "@/lib/messages";
import { forgetLastJob } from "./lastJob";
import { archiveConfirmText } from "./messages";

export interface ArchiveJobDialogProps {
  readonly job: JobDetail;
  readonly open: boolean;
  readonly onClose: () => void;
}

/** "Archive S-0001? …" (§5.1): archives with `If-Match`, then opens the dashboard, which shows "S-0001 was archived.". */
export function ArchiveJobDialog({ job, open, onClose }: ArchiveJobDialogProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const banners = useBanners();
  const queryKey = queryKeys.jobs.detail(job.id);
  const archive = useMutation({
    mutationFn: () => {
      const current = queryClient.getQueryData<JobDetail>(queryKey) ?? job;
      return api("deleteJob", { params: { jobId: job.id }, ifMatch: current.version });
    },
    onSuccess: async () => {
      forgetLastJob(job.id);
      await queryClient.cancelQueries({ queryKey });
      queryClient.removeQueries({ queryKey });
      void queryClient.invalidateQueries({ queryKey: queryKeys.jobs.all });
      router.push(`/?archived=${encodeURIComponent(job.jobNumber)}`);
    },
    onError: async (error) => {
      onClose();
      if (error instanceof ApiProblem && error.isStale) {
        await queryClient.refetchQueries({ queryKey });
        banners.show("stale", MESSAGES.stale);
      } else {
        banners.show("save-failed", saveFailedText(error instanceof ApiProblem ? error.requestId : undefined));
      }
    },
  });
  return (
    <ConfirmDialog
      open={open}
      title="Archive job"
      confirmLabel="ARCHIVE"
      busy={archive.isPending}
      onConfirm={() => {
        archive.mutate();
      }}
      onCancel={onClose}
    >
      {archiveConfirmText(job.jobNumber)}
    </ConfirmDialog>
  );
}
