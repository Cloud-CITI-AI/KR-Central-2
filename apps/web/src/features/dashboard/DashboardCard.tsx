import type { JobCard } from "@kr/contracts";
import { RESPONSIBILITY_LABELS } from "@kr/workflow";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { VisuallyHidden } from "@/components/ui/VisuallyHidden";
import { cx } from "@/lib/cx";
import styles from "./DashboardCard.module.css";

export interface DashboardCardProps {
  readonly job: JobCard;
}

const MAX_NEXT_ACTIONS = 4;

/**
 * One job on the dashboard (§6). Everything shown is what the API computed for the card (`progress`, `nextActions`,
 * `alerts`): the workflow rules are never recomputed in the browser.
 */
export function DashboardCard({ job }: DashboardCardProps) {
  const { progress, alerts, nextActions } = job;
  const shown = nextActions.slice(0, MAX_NEXT_ACTIONS);
  const hidden = nextActions.length - shown.length;
  const width = (count: number) => ({ width: `${(count / progress.total) * 100}%` });
  return (
    <article className={cx(styles.card, job.isComplete && styles.done)} aria-labelledby={`job-${job.id}`}>
      <div className={styles.top}>
        <b id={`job-${job.id}`} className={styles.num}>
          {job.jobNumber}
        </b>
        <span className={cx(styles.state, job.isComplete ? styles.complete : styles.inProgress)}>
          {job.isComplete ? "Complete" : "In progress"}
        </span>
        <span className={styles.pct}>{progress.percent}%</span>
      </div>
      <div className={styles.addr}>{job.address}</div>
      <div className={styles.meta}>{[job.clientName, job.subdivisionType].filter(Boolean).join(" · ")}</div>
      <div
        className={styles.bar}
        role="img"
        aria-label={`${progress.completed} completed, ${progress.notRequired} not required, ${progress.notCompleted} not completed`}
      >
        <i className={styles.g} style={width(progress.completed)} />
        <i className={styles.x} style={width(progress.notRequired)} />
        <i className={styles.n} style={width(progress.notCompleted)} />
      </div>
      <div className={styles.note}>
        <div className={styles.noteHead}>{job.isComplete ? "All done" : "Next to action"}</div>
        {alerts.length > 0 && (
          <ul className={styles.alerts}>
            {alerts.map((alert) => (
              <li key={`${alert.code}-${alert.checkpointKey ?? ""}`} className={styles[alert.level]}>
                {alert.text}
              </li>
            ))}
          </ul>
        )}
        {job.isComplete ? (
          <div className={styles.empty}>Plan in order for dealings – nothing left to action.</div>
        ) : shown.length > 0 ? (
          <ul className={styles.next}>
            {shown.map((action) => (
              <li key={action.checkpointKey}>
                <span className={styles.number}>{action.number}</span>
                <span className={styles.title}>{action.title}</span>
                <span className={cx(styles.who, styles[action.responsibility ?? "unassigned"])}>
                  {RESPONSIBILITY_LABELS[action.responsibility ?? "unassigned"]}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <div className={styles.empty}>Everything open is marked – check 12.3 Plan in order for dealings.</div>
        )}
        {!job.isComplete && hidden > 0 && (
          <div className={styles.more}>{`+ ${hidden} more stage${hidden > 1 ? "s" : ""} with open items`}</div>
        )}
      </div>
      <div className={styles.openJob}>
        <ButtonLink href={`/jobs/${job.id}`} small>
          Open job <span aria-hidden="true">→</span>
          <VisuallyHidden> {job.jobNumber}</VisuallyHidden>
        </ButtonLink>
      </div>
    </article>
  );
}
