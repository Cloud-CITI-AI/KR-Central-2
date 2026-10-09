"use client";
import type { CheckpointState, JobDetail } from "@kr/contracts";
import type { EmailsPanel as EmailsPanelDefinition } from "@kr/workflow";
import { useViewer } from "@/features/viewer";
import { EmailRow } from "./EmailRow";
import { EmailZone } from "./EmailZone";
import { Folder, FolderHeader } from "./Folder";
import { fileCountText } from "./messages";
import { PanelBox } from "./PanelBox";
import { filesInSlot } from "./slotFiles";
import { useDeleteFile } from "./useDeleteFile";
import styles from "./Emails.module.css";

export interface EmailsPanelProps {
  readonly job: JobDetail;
  readonly checkpoint: CheckpointState;
  readonly panel: EmailsPanelDefinition;
}

/**
 * 4.3 Queries from WAPC (§5.5 `emails`): "Query emails  none yet / 2 emails", the list (subject opens the viewer, "From · 28 Sep
 * 2026, 3:50 pm", remove) and the zone that takes .msg / .eml files and pasted text.
 */
export function EmailsPanel({ job, checkpoint, panel }: EmailsPanelProps) {
  const { slot } = panel;
  const viewer = useViewer();
  const { remove, removing } = useDeleteFile(job.id, checkpoint.key);
  const emails = filesInSlot(checkpoint.files, slot.key);
  return (
    <PanelBox>
      <Folder>
        <FolderHeader title={slot.title} count={fileCountText(emails.length, "none yet", "email")} />
        {emails.length > 0 && (
          <ul className={styles.mails}>
            {emails.map((file) => (
              <EmailRow
                key={file.id}
                file={file}
                removing={removing.has(file.id)}
                onOpen={() => {
                  viewer.open(
                    emails,
                    emails.findIndex((f) => f.id === file.id),
                  );
                }}
                onRemove={(target) => {
                  void remove(target);
                }}
              />
            ))}
          </ul>
        )}
        <EmailZone job={job} checkpointKey={checkpoint.key} slot={slot} />
      </Folder>
    </PanelBox>
  );
}
