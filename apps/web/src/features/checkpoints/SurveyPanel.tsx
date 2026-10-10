import type { CheckpointState, JobDetail } from "@kr/contracts";
import type { SurveyPanel as SurveyPanelDefinition } from "@kr/workflow";
import { FileRows } from "./FileRows";
import { Folder, FolderHeader } from "./Folder";
import { fileCountText } from "./messages";
import { PanelBox } from "./PanelBox";
import { RequirementChips } from "./RequirementChips";
import { SlotZone } from "./SlotZone";
import { countsAsReceived, filesInSlot } from "./slotFiles";

export interface SurveyPanelProps {
  readonly job: JobDetail;
  readonly checkpoint: CheckpointState;
  readonly panel: SurveyPanelDefinition;
}

/**
 * 2.0 Site Feature Survey (§5.5): "Feature survey  empty", the chips "PDF required" / "✓ PDF received" and the same for DWG
 * (each required kind of the slot must be there at least once), the rows, and a zone that takes PDF and DWG only.
 */
export function SurveyPanel({ job, checkpoint, panel }: SurveyPanelProps) {
  const { slot } = panel;
  const files = filesInSlot(checkpoint.files, slot.key);
  return (
    <PanelBox>
      <Folder>
        <FolderHeader title={slot.title} count={fileCountText(files.length, "empty")} />
        <RequirementChips
          chips={(slot.requiredKinds ?? []).map((kind) => ({
            label: kind.toUpperCase(),
            received: files.some((file) => file.kind === kind && countsAsReceived(file)),
          }))}
        />
        <FileRows jobId={job.id} checkpointKey={checkpoint.key} files={files} />
        <SlotZone job={job} checkpointKey={checkpoint.key} slot={slot} />
      </Folder>
    </PanelBox>
  );
}
