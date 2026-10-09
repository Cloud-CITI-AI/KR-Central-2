import type { CheckpointState, JobDetail } from "@kr/contracts";
import type { DocumentsPanel } from "@kr/workflow";
import { canUploadToSlot } from "./capabilities";
import { FileRows } from "./FileRows";
import { Folder, FolderHeader } from "./Folder";
import { fileCountText } from "./messages";
import { OpenAll } from "./OpenAll";
import { PanelBox } from "./PanelBox";
import { isServable, PhotoGrid } from "./PhotoGrid";
import { SlotZone } from "./SlotZone";
import { filesInSlot } from "./slotFiles";

export interface PhotosPanelProps {
  readonly job: JobDetail;
  readonly checkpoint: CheckpointState;
  readonly panel: DocumentsPanel;
}

/**
 * 11.0 set-out photos (§5.5 `documents`, variant `photos`): "<title>  3 photos" / "none yet", "View all" for more than one,
 * a grid of thumbnails that open the viewer, and the zone. The rows under the grid (to remove a photo, and to show a scan
 * state) are listed for people who can upload, and for any photo that cannot be shown.
 */
export function PhotosPanel({ job, checkpoint, panel }: PhotosPanelProps) {
  const { slot } = panel;
  const photos = filesInSlot(checkpoint.files, slot.key);
  const canUpload = canUploadToSlot(job.capabilities, slot);
  return (
    <PanelBox>
      <Folder>
        <FolderHeader
          title={slot.title}
          count={fileCountText(photos.length, "none yet", "photo")}
          action={photos.length > 1 ? <OpenAll files={photos} label="View all" /> : undefined}
        />
        <PhotoGrid photos={photos} />
        <FileRows
          jobId={job.id}
          checkpointKey={checkpoint.key}
          files={canUpload ? photos : photos.filter((photo) => !isServable(photo))}
        />
        <SlotZone job={job} checkpointKey={checkpoint.key} slot={slot} />
      </Folder>
    </PanelBox>
  );
}
