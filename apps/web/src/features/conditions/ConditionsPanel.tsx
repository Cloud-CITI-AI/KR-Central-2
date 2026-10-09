"use client";
import type { CheckpointState, JobDetail } from "@kr/contracts";
import { getCheckpoint, slotsOf } from "@kr/workflow";
import {
  canUploadToSlot,
  fileCountText,
  FileRows,
  filesInSlot,
  Folder,
  FolderHeader,
  FolderHint,
  PanelBox,
  SlotZone,
} from "@/features/checkpoints";
import { ConditionsChecklist } from "./ConditionsChecklist";
import { ExtractionActions } from "./ExtractionActions";
import { LETTER_GOES_HERE } from "./messages";
import styles from "./Conditions.module.css";

export interface ConditionsPanelProps {
  readonly job: JobDetail;
  /** The 5.0 checkpoint (files in slot "decision"). */
  readonly checkpoint: CheckpointState;
}

/**
 * 5.0 body (§5.5 `conditions`): the "WAPC conditional approval" folder with its PDF zone, the extract buttons of the Decision
 * Letter and the result message. The conditions checklist follows once conditions exist.
 */
export function ConditionsPanel({ job, checkpoint }: ConditionsPanelProps) {
  const slot = slotsOf(getCheckpoint(checkpoint.key))[0];
  if (!slot) return null;
  const files = filesInSlot(checkpoint.files, slot.key);
  return (
    <PanelBox>
      <div className={styles.panel} data-conditions-count={job.conditions.length}>
        <Folder>
          <FolderHeader title={slot.title} count={fileCountText(files.length, "empty")} />
          <FileRows jobId={job.id} checkpointKey={checkpoint.key} files={files} />
          <SlotZone job={job} checkpointKey={checkpoint.key} slot={slot} />
          {files.length === 0 && !canUploadToSlot(job.capabilities, slot) && (
            <FolderHint>{LETTER_GOES_HERE}</FolderHint>
          )}
        </Folder>
        <ExtractionActions job={job} pdfs={files.filter((file) => file.kind === "pdf")} />
        <ConditionsChecklist job={job} />
      </div>
    </PanelBox>
  );
}
