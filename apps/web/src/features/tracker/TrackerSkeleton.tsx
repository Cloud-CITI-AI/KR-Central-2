import { STAGES } from "@kr/workflow";
import { Spinner } from "@/components/ui/Spinner";
import styles from "./TrackerSkeleton.module.css";

/**
 * What the tracker page shows until the job has loaded: the jobbar row with the busy status, two summary panels, the ten stage bars
 * and the notes and files panels as empty boxes at their real size, so the footer and everything below the fold stay where they are
 * when the job arrives (a replaced spinner used to shift the main column and the footer: CLS 0.654 against a budget of 0.1).
 * Only the status is announced; the boxes are decoration.
 */
export function TrackerSkeleton() {
  return (
    <div className={styles.skeleton} aria-busy="true">
      <div className={styles.jobbar}>
        <Spinner label="Loading job…" />
      </div>
      <div className={styles.summary} aria-hidden="true">
        <div className={styles.panel} />
        <div className={styles.panel} />
      </div>
      <div className={styles.tools} aria-hidden="true" />
      <div className={styles.stages} aria-hidden="true">
        {STAGES.map((stage) => (
          <div key={stage.key} className={styles.bar} />
        ))}
      </div>
      <div className={styles.after} aria-hidden="true">
        <div />
        <div />
      </div>
    </div>
  );
}
