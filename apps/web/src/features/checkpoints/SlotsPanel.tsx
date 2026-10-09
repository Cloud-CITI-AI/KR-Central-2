import type { CheckpointState, JobDetail } from "@kr/contracts";
import type { SlotsPanel as SlotsPanelDefinition } from "@kr/workflow";
import { FileRows } from "./FileRows";
import { Folder, FolderHeader, SlotTitle } from "./Folder";
import { fileCountText } from "./messages";
import { PanelBox } from "./PanelBox";
import { RequirementChips } from "./RequirementChips";
import { SlotZone } from "./SlotZone";
import { filesInSlot, filesOutsideSlots } from "./slotFiles";

export interface SlotsPanelProps {
  readonly job: JobDetail;
  readonly checkpoint: CheckpointState;
  readonly panel: SlotsPanelDefinition;
}

/**
 * Several required files, each with its own box (§5.5 `slots`: 6.8 clearance PDF and email, 7.3 plumber documents): the
 * requirement chips, then one sub-folder per slot, then "Other files" for files whose slot no longer exists.
 */
export function SlotsPanel({ job, checkpoint, panel }: SlotsPanelProps) {
  const other = filesOutsideSlots(
    checkpoint.files,
    panel.slots.map((slot) => slot.key),
  );
  return (
    <PanelBox>
      <FolderHeader title={panel.title} count={fileCountText(checkpoint.files.length, "not received yet")} />
      <RequirementChips
        chips={panel.slots
          .filter((slot) => slot.showRequirementChip)
          .map((slot) => ({ label: slot.title, received: filesInSlot(checkpoint.files, slot.key).length > 0 }))}
      />
      {panel.slots.map((slot) => (
        <Folder key={slot.key} slot>
          <SlotTitle>{slot.title}</SlotTitle>
          <FileRows jobId={job.id} checkpointKey={checkpoint.key} files={filesInSlot(checkpoint.files, slot.key)} />
          <SlotZone job={job} checkpointKey={checkpoint.key} slot={slot} />
        </Folder>
      ))}
      {other.length > 0 && (
        <Folder slot>
          <SlotTitle>Other files</SlotTitle>
          <FileRows jobId={job.id} checkpointKey={checkpoint.key} files={other} />
        </Folder>
      )}
    </PanelBox>
  );
}
