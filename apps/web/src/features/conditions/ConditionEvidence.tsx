"use client";
import type { Condition, JobDetail } from "@kr/contracts";
import { useMemo } from "react";
import { FileList } from "@/components/ui/FileList";
import { useDeleteFile, type FileListEdit } from "@/features/checkpoints";
import { useViewer } from "@/features/viewer";
import { withEvidence, withoutEvidence } from "./cache";
import { conditionPermissions } from "./capabilities";
import { EvidenceZone } from "./EvidenceZone";

export interface ConditionEvidenceProps {
  readonly job: JobDetail;
  readonly condition: Condition;
}

/**
 * The evidence of a condition (§5.6): document rows whose name opens the viewer on the condition's files, × asks "Remove? Yes / No",
 * and the small drop zone for those with `conditions.evidence.upload`.
 */
export function ConditionEvidence({ job, condition }: ConditionEvidenceProps) {
  const viewer = useViewer();
  const evidence = useMemo<FileListEdit>(
    () => ({
      without: (j, file) => withoutEvidence(j, condition.id, file),
      restore: (j, file) => withEvidence(j, condition.id, file),
    }),
    [condition.id],
  );
  const { remove, removing } = useDeleteFile(job.id, evidence);
  const files = condition.evidence;
  const canUpload = conditionPermissions(job.capabilities).evidence;
  if (files.length === 0 && !canUpload) return null;
  return (
    <>
      {files.length > 0 && (
        <FileList
          files={files}
          removing={removing}
          onOpen={(file) => {
            viewer.open(
              files,
              files.findIndex((f) => f.id === file.id),
            );
          }}
          onRemove={(file) => {
            void remove(file);
          }}
        />
      )}
      {canUpload && <EvidenceZone jobId={job.id} condition={condition} />}
    </>
  );
}
