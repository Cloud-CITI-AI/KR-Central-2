import type { JobDetail } from "@kr/contracts";
import { ProgressPanel } from "./ProgressPanel";
import { StatusKey } from "./StatusKey";
import styles from "./SummaryPanels.module.css";

export interface SummaryPanelsProps {
  readonly job: JobDetail;
}

/** The two summary panels side by side, stacked under 760 px (§5.2): progress (with the approval dates) and the status key. */
export function SummaryPanels({ job }: SummaryPanelsProps) {
  return (
    <div className={styles.summary}>
      <ProgressPanel job={job} />
      <StatusKey />
    </div>
  );
}
