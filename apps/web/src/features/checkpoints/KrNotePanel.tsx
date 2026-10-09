"use client";
import type { CheckpointState, JobDetail } from "@kr/contracts";
import type { KrNotePanel as KrNotePanelDefinition } from "@kr/workflow";
import { Textarea } from "@/components/ui/Textarea";
import { PanelBox } from "./PanelBox";
import { useAutosaveText } from "./useAutosaveText";
import { useUpdateCheckpoint } from "./useUpdateCheckpoint";
import notePanel from "./KrNotePanel.module.css";
import styles from "./Response.module.css";

export interface KrNotePanelProps {
  readonly job: JobDetail;
  readonly checkpoint: CheckpointState;
  readonly panel: KrNotePanelDefinition;
}

/**
 * The KR Surveys comment (§5.5 `kr_note`, 8.1): a labelled textarea that autosaves 700 ms after typing stops and on blur, and
 * is read-only for anyone without `checkpoint.kr_note.edit` (clients read it to see what they need to pay).
 */
export function KrNotePanel({ job, checkpoint, panel }: KrNotePanelProps) {
  const update = useUpdateCheckpoint(job.id, checkpoint.key);
  const field = useAutosaveText({
    value: checkpoint.krNote,
    onSave: (krNote) => {
      return update.mutateAsync({ krNote }).catch(() => undefined);
    },
  });
  return (
    <PanelBox>
      <label className={notePanel.note}>
        <span className={styles.label}>{panel.label}</span>
        <Textarea
          className={notePanel.field}
          rows={3}
          maxLength={2000}
          placeholder={panel.placeholder}
          readOnly={!job.capabilities.includes("checkpoint.kr_note.edit")}
          value={field.text}
          onChange={field.onChange}
          onFocus={field.onFocus}
          onBlur={field.onBlur}
        />
      </label>
    </PanelBox>
  );
}
