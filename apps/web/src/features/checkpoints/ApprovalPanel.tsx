import type { CheckpointState, JobDetail } from "@kr/contracts";
import type { ApprovalPanel as ApprovalPanelDefinition } from "@kr/workflow";
import { canUploadToSlot } from "./capabilities";
import { DecisionArea } from "./DecisionArea";
import { FileRows } from "./FileRows";
import { Folder, FolderHeader, FolderHint } from "./Folder";
import { fileCountText } from "./messages";
import { OpenAll } from "./OpenAll";
import { PanelBox } from "./PanelBox";
import { SlotZone } from "./SlotZone";
import { filesInSlot } from "./slotFiles";

export interface ApprovalPanelProps {
  readonly job: JobDetail;
  readonly checkpoint: CheckpointState;
  readonly panel: ApprovalPanelDefinition;
}

/**
 * An approval panel (§5.5): the optional document folder ("Fee proposal documents", "Quote documents") with its zone, or the
 * folder's hint when it is empty and the viewer cannot upload; the optional extra slot (3.0 "Completed letter of consent");
 * then the decision area. Buttons and the decision form follow `checkpoint.decision.record`.
 */
export function ApprovalPanel({ job, checkpoint, panel }: ApprovalPanelProps) {
  const { folder, extraSlot } = panel;
  const folderFiles = folder ? filesInSlot(checkpoint.files, folder.slot.key) : [];
  const extraFiles = extraSlot ? filesInSlot(checkpoint.files, extraSlot.key) : [];
  return (
    <PanelBox>
      {folder && (
        <Folder>
          <FolderHeader
            title={folder.title}
            count={fileCountText(folderFiles.length, "empty")}
            action={folderFiles.length > 0 ? <OpenAll files={folderFiles} /> : undefined}
          />
          <FileRows jobId={job.id} checkpointKey={checkpoint.key} files={folderFiles} />
          {canUploadToSlot(job.capabilities, folder.slot) ? (
            <SlotZone job={job} checkpointKey={checkpoint.key} slot={folder.slot} large />
          ) : (
            folderFiles.length === 0 && <FolderHint>{folder.hint}</FolderHint>
          )}
        </Folder>
      )}
      {extraSlot && (
        <Folder>
          <FolderHeader
            title={extraSlot.title}
            count={extraFiles.length === 0 ? "not received yet" : `${fileCountText(extraFiles.length, "")} received`}
          />
          <FileRows jobId={job.id} checkpointKey={checkpoint.key} files={extraFiles} />
          <SlotZone job={job} checkpointKey={checkpoint.key} slot={extraSlot} large />
        </Folder>
      )}
      <DecisionArea
        jobId={job.id}
        checkpoint={checkpoint}
        panel={panel}
        canRecord={job.capabilities.includes("checkpoint.decision.record")}
      />
    </PanelBox>
  );
}
