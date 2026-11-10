import { cx } from "@/lib/cx";
import styles from "./JobHeading.module.css";

/** What the heading shows. The page has these from the server before the job itself has loaded in the browser. */
export interface JobHeadingFacts {
  readonly jobNumber: string;
  readonly address: string;
  readonly clientName: string | null;
  readonly subdivisionType: string | null;
  readonly isComplete: boolean;
}

export interface JobHeadingProps {
  readonly job: JobHeadingFacts;
}

/**
 * The job's title row (§5.1): number large, address beside it, then client, type and state as facts. Nothing in it can
 * be clicked, so it is safe to draw in the first HTML, before the page's scripts run; it is the page's largest content.
 */
export function JobHeading({ job }: JobHeadingProps) {
  const complete = job.isComplete;
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
