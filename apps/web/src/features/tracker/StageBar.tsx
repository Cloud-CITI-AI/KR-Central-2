import type { JobDetail } from "@kr/contracts";
import type { StageDefinition } from "@kr/workflow";
import styles from "./Stages.module.css";

type StageSummary = JobDetail["summary"]["stages"][number];

export interface StageBarProps {
  readonly stage: StageDefinition;
  readonly summary: StageSummary;
  readonly open: boolean;
  /** Id of the stage body this bar opens (`aria-controls`). */
  readonly bodyId: string;
  readonly onToggle: () => void;
}

/**
 * The stage bar (§5.3): chevron, upper-case name, "N to do" / "Complete" / "Not required", 90 px track and percentage,
 * coloured by the stage state. An excluded agency stage is a disabled grey bar that cannot be opened. Each bar is the content of a
 * level-2 heading (the page outline is the stages, then their checkpoints; WCAG 1.3.1, 2.4.6): the heading adds no visual of its own.
 */
export function StageBar({ stage, summary, open, bodyId, onToggle }: StageBarProps) {
  if (summary.excluded) {
    return (
      <h2 className={styles.heading}>
        <span
          className={`${styles.bar} ${styles.off}`}
          data-state="not_required"
          title={`The Decision Letter has no conditions for ${stage.name}`}
        >
          <span className={styles.chev} aria-hidden="true" />
          <span className={styles.name}>{stage.name}</span>{" "}
          <span className={styles.meta}>
            <span className={styles.count}>{summary.label}</span>
          </span>
        </span>
      </h2>
    );
  }
  return (
    <h2 className={styles.heading}>
      <button
        type="button"
        className={styles.bar}
        data-state={summary.state}
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={onToggle}
      >
        <span className={styles.chev} aria-hidden="true" />
        <span className={styles.name}>{stage.name}</span>{" "}
        <span className={styles.meta}>
          <span className={styles.count}>{summary.label}</span>{" "}
          <span className={styles.track} aria-hidden="true">
            <i style={{ width: `${summary.percent}%` }} />
          </span>
          <b className={styles.pct}>{summary.percent}%</b>
        </span>
      </button>
    </h2>
  );
}
