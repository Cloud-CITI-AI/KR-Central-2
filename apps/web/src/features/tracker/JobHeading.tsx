import type { JobDetail } from "@kr/contracts";
import { cx } from "@/lib/cx";
import styles from "./JobHeading.module.css";

export interface JobHeadingProps {
  readonly job: JobDetail;
}

/** The job's title row (§5.1): number large, address beside it, then client, type and state as facts. */
export function JobHeading({ job }: JobHeadingProps) {
  const complete = job.summary.isComplete;
  return (
    <div className={styles.head}>
      <h1 className={styles.title}>
        {job.jobNumber}
        <span className={styles.address}>{job.address}</span>
      </h1>
      <div className={styles.facts}>
        {job.clientName && (
          <span>
            Client <b>{job.clientName}</b>
          </span>
        )}
        {job.subdivisionType && (
          <span>
            Type <b>{job.subdivisionType}</b>
          </span>
        )}
        <span className={cx(styles.state, complete ? styles.complete : styles.inProgress)}>
          {complete ? "Complete" : "In progress"}
        </span>
      </div>
    </div>
  );
}
