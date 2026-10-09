import type { CheckpointState, JobDetail } from "@kr/contracts";
import type { SlotDefinition } from "@kr/workflow";
import { FileRows } from "./FileRows";
import { Folder, FolderHeader } from "./Folder";
import { fileCountText } from "./messages";
import { OpenAll } from "./OpenAll";
import { PanelBox } from "./PanelBox";
import { SlotZone } from "./SlotZone";
import { filesInSlot } from "./slotFiles";

export interface SlotFolderPanelProps {
  readonly job: JobDetail;
  readonly checkpoint: CheckpointState;
  readonly slot: SlotDefinition;
}

/**
 * A single titled folder with its drop zone (§5.5 `documents` and `clearance`): "<title>  2 files" or "not received yet",
 * "Open all" once there is more than one file, the document rows, and the zone for those who may upload.
 */
export function SlotFolderPanel({ job, checkpoint, slot }: SlotFolderPanelProps) {
  const files = filesInSlot(checkpoint.files, slot.key);
  return (
    <PanelBox>
      <Folder>
        <FolderHeader
          title={slot.title}
          count={fileCountText(files.length, "not received yet")}
          action={files.length > 1 ? <OpenAll files={files} /> : undefined}
        />
        <FileRows jobId={job.id} checkpointKey={checkpoint.key} files={files} />
        <SlotZone job={job} checkpointKey={checkpoint.key} slot={slot} />
      </Folder>
    </PanelBox>
  );
}
