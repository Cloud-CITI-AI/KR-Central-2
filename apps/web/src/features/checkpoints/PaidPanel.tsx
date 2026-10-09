"use client";
import type { CheckpointState, JobDetail } from "@kr/contracts";
import { formatInstantShort, type PaidPanel as PaidPanelDefinition } from "@kr/workflow";
import { Button } from "@/components/ui/Button";
import { cx } from "@/lib/cx";
import { PanelBox } from "./PanelBox";
import { useMarkPaid, useUndoPaid } from "./usePaid";
import paid from "./Paid.module.css";
import styles from "./Response.module.css";

export interface PaidPanelProps {
  readonly job: JobDetail;
  readonly checkpoint: CheckpointState;
  readonly panel: PaidPanelDefinition;
}

/**
 * The client response box (§5.5 `paid`): its label ("Client response" / "Client decision") and one green button with the
 * definition's text (INVOICE PAID, WORKS COMPLETE, FEE PAID, QUOTE PAID, TITLES OBTAINED). Pressing it records the time and
 * the API sets Completed; the done state reads "Invoice paid 28 Sep 2026" with Undo, which clears it and sets Not completed.
 * Both need `checkpoint.paid.record`.
 */
export function PaidPanel({ job, checkpoint, panel }: PaidPanelProps) {
  const markPaid = useMarkPaid(job.id, checkpoint.key);
  const undoPaid = useUndoPaid(job.id, checkpoint.key);
  const canRecord = job.capabilities.includes("checkpoint.paid.record");
  const busy = markPaid.isPending || undoPaid.isPending;
  return (
    <PanelBox>
      <div className={paid.paid}>
        <div className={styles.label}>{panel.label}</div>
        {checkpoint.paid ? (
          <div className={cx(styles.result, paid.result)} data-v="accepted">
            <div className={styles.row}>
              <b>{panel.doneLabel}</b>
              <span className={styles.date}>{formatInstantShort(checkpoint.paid.at)}</span>
              {canRecord && (
                <Button
                  small
                  className={styles.change}
                  disabled={busy}
                  onClick={() => {
                    undoPaid.mutate(undefined);
                  }}
                >
                  Undo
                </Button>
              )}
            </div>
          </div>
        ) : (
          <Button
            className={styles.accept}
            disabled={!canRecord || busy}
            onClick={() => {
              markPaid.mutate(undefined);
            }}
          >
            {panel.buttonLabel}
          </Button>
        )}
      </div>
    </PanelBox>
  );
}
