"use client";
import type { Condition } from "@kr/contracts";
import { EVIDENCE_ACCEPT } from "@kr/workflow";
import { DropZone } from "@/components/ui/DropZone";
import { slotFileRules, useUploadFiles } from "@/features/checkpoints";
import { useSession } from "@/lib/session";
import { withEvidence } from "./cache";
import { EVIDENCE_HINT, EVIDENCE_LABEL } from "./messages";
import styles from "./EvidenceZone.module.css";

export interface EvidenceZoneProps {
  readonly jobId: string;
  readonly condition: Condition;
}

/** "Drop clearance evidence here": the small drop zone of a condition, with the upload progress and the refused files under it (§5.6). */
export function EvidenceZone({ jobId, condition }: EvidenceZoneProps) {
  const { uploadMaxBytes } = useSession();
  const { upload, busy, progress, errors } = useUploadFiles({
    jobId,
    conditionId: condition.id,
    accept: EVIDENCE_ACCEPT,
    addFile: (job, file) => withEvidence(job, condition.id, file),
  });
  return (
    <div>
      <DropZone
        small
        busy={busy}
        label={EVIDENCE_LABEL}
        hint={EVIDENCE_HINT}
        onFiles={(files) => {
          void upload(files);
        }}
        {...slotFileRules({ accept: EVIDENCE_ACCEPT }, uploadMaxBytes)}
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
