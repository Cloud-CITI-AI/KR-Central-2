import type { JobDetail } from "@kr/contracts";
import type { CSSProperties, ReactNode } from "react";
import { Panel } from "@/components/ui/Panel";
import styles from "./SummaryPanels.module.css";

export interface ProgressPanelProps {
  readonly job: JobDetail;
  /** Below the rule: the approval date and expiry inputs (§5.2). */
  readonly children?: ReactNode;
}

/** "SUBDIVISION PROGRESS" (§5.2): progress ring, stacked bar and count chips from the job's summary, then the dates. */
export function ProgressPanel({ job, children }: ProgressPanelProps) {
  const { completed, notCompleted, notRequired, total, percent } = job.summary.progress;
  const share = (count: number) => `${total === 0 ? 0 : (count / total) * 100}%`;
  return (
    <Panel title="Subdivision progress">
      <div className={styles.prog}>
        <div className={styles.pct} style={{ "--pc": percent } as CSSProperties}>
          {percent}%
        </div>
        <div className={styles.progRight}>
          <div
            className={styles.bar}
            role="img"
            aria-label={`${completed} completed, ${notRequired} not required, ${notCompleted} not completed of ${total}`}
          >
            <i className={styles.barCompleted} style={{ width: share(completed) }} />
            <i className={styles.barNotRequired} style={{ width: share(notRequired) }} />
            <i className={styles.barNotCompleted} style={{ width: share(notCompleted) }} />
          </div>
          <div className={styles.counts}>
            <span className={`${styles.cnt} ${styles.cntCompleted}`}>
              <b>{completed}</b> Completed
            </span>
            <span className={`${styles.cnt} ${styles.cntNotCompleted}`}>
              <b>{notCompleted}</b> Not completed
            </span>
            <span className={`${styles.cnt} ${styles.cntNotRequired}`}>
              <b>{notRequired}</b> Not required
            </span>
          </div>
        </div>
      </div>
      {children}
    </Panel>
  );
}
