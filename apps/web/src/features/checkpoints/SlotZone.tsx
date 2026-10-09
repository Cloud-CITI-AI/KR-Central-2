"use client";
import type { JobDetail } from "@kr/contracts";
import type { SlotDefinition } from "@kr/workflow";
import type { ReactNode } from "react";
import { DropZone } from "@/components/ui/DropZone";
import { useSession } from "@/lib/session";
import { slotFileRules } from "./accept";
import { canUploadToSlot } from "./capabilities";
import { useUploadFiles, type UseUploadFiles } from "./useUploadFiles";
import styles from "./SlotZone.module.css";

export interface SlotZoneProps {
  readonly job: JobDetail;
  readonly checkpointKey: string;
  readonly slot: SlotDefinition;
  /** Replaces the slot's bold line (e.g. "Reading the conformed date…"). */
  readonly label?: ReactNode;
  /** Replaces the slot's hint. */
  readonly hint?: ReactNode;
  /** The prototype's roomier zone (decision documents, emails) instead of the small one. */
  readonly large?: boolean;
  /** Called with the stored files once an upload finishes (the conformance panel follows the read it starts). */
  readonly onUploaded?: (stored: Awaited<ReturnType<UseUploadFiles["upload"]>>) => void;
}

/**
 * The drop zone of one slot, with its upload progress and the per-file errors under it. Renders nothing unless the viewer
 * may upload into the slot (`files.upload.staff_slots` / `files.upload.client_slots`).
 */
export function SlotZone({ job, checkpointKey, slot, label, hint, large = false, onUploaded }: SlotZoneProps) {
  const { uploadMaxBytes } = useSession();
  const { upload, busy, progress, errors } = useUploadFiles({ jobId: job.id, checkpointKey, slot });
  if (!canUploadToSlot(job.capabilities, slot)) return null;
  return (
    <div>
      <DropZone
        small={!large}
        busy={busy}
        label={label ?? slot.dropLabel}
        hint={hint ?? slot.dropHint}
        onFiles={(files) => {
          void upload(files).then((stored) => {
            if (stored.length > 0) onUploaded?.(stored);
          });
        }}
        {...slotFileRules(slot, uploadMaxBytes)}
      />
      {progress && (
        <div className={styles.status}>
          <progress aria-label={`Uploading ${progress.name}`} value={progress.fraction} max={1} />
          <span aria-hidden="true">
            {progress.name} – {Math.round(progress.fraction * 100)}%
          </span>
        </div>
      )}
      <ul className={styles.errors} aria-live="polite">
        {errors.map((message) => (
          <li key={message}>{message}</li>
        ))}
      </ul>
    </div>
  );
}
