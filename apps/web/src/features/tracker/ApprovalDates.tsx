"use client";
import type { JobDetail } from "@kr/contracts";
import { approvalExpiryStatus } from "@kr/workflow";
import { useId } from "react";
import { DateField } from "./DateField";
import { useNow } from "./useNow";
import { useUpdateJob } from "./useUpdateJob";
import styles from "./ApprovalDates.module.css";

export interface ApprovalDatesProps {
  readonly job: JobDetail;
}

const MINUTE_MS = 60_000;

/**
 * WAPC APPROVAL DATE and APPROVAL EXPIRY (§5.2), editable with `job.edit`. Under the expiry: "768 days left to lodge Form 1C"
 * (green ≥ 180 days, amber under, red once past), refreshed every minute from the injected clock.
 */
export function ApprovalDates({ job }: ApprovalDatesProps) {
  const update = useUpdateJob(job.id);
  const statusId = useId();
  const now = useNow(MINUTE_MS);
  const canEdit = job.capabilities.includes("job.edit");
  const expiry = job.approvalExpiry ? approvalExpiryStatus(job.approvalExpiry, now) : null;
  return (
    <div className={styles.appr}>
      <DateField
        label="WAPC approval date"
        value={job.approvalDate}
        disabled={!canEdit}
        onCommit={(approvalDate) => update.mutateAsync({ approvalDate })}
      />
      <DateField
        label="Approval expiry"
        describedBy={expiry ? statusId : undefined}
        value={job.approvalExpiry}
        disabled={!canEdit}
        onCommit={(approvalExpiry) => update.mutateAsync({ approvalExpiry })}
      >
        {expiry && (
          <span id={statusId} className={`${styles.status} ${styles[expiry.level]}`}>
            {expiry.text}
          </span>
        )}
      </DateField>
      {!job.approvalDate && !job.approvalExpiry && (
        <span className={styles.hint}>
          Filled in automatically when conditions are extracted from the Decision Letter in 5.0
        </span>
      )}
    </div>
  );
}
