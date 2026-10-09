"use client";
import type { JobDetail } from "@kr/contracts";
import { outcomeDateFor } from "@kr/workflow";
import { Countdown } from "./Countdown";
import { DateField } from "./DateField";
import { useUpdateJob } from "./useUpdateJob";
import styles from "./OutcomeBox.module.css";

export interface OutcomeBoxProps {
  readonly job: JobDetail;
}

/** "Stamped date on page 1 …" / "Read from <file>" / "Entered by hand" (§5.5). */
function conformedHint(job: JobDetail): string {
  if (!job.conformedDate) return "Stamped date on page 1 of the Conformance Notification";
  const source = job.conformedSource;
  if (!source || source.method === "manual") return "Entered by hand";
  return `Read from ${source.fileName ?? "the Conformance Notification"}`;
}

/**
 * The WAPC outcome box after 4.2 (§5.5): the conformed date (entering one sets the outcome date to +90 days) and the outcome
 * date (an override such as a deferral, with "· reset to 90 days"), and on the right the live countdown, or a prompt to
 * start it. Both dates are editable with `job.edit`.
 */
export function OutcomeBox({ job }: OutcomeBoxProps) {
  const update = useUpdateJob(job.id);
  const canEdit = job.capabilities.includes("job.edit");
  const { conformedDate, outcomeDate } = job;
  const isAutomatic = !outcomeDate || (conformedDate !== null && outcomeDate === outcomeDateFor(conformedDate));
  return (
    <div className={styles.outcome} role="group" aria-label="WAPC outcome">
      <div className={styles.dates}>
        <DateField
          label="Conformed date"
          labelClassName={styles.title}
          value={conformedDate}
          disabled={!canEdit}
          onCommit={(next) => update.mutateAsync({ conformedDate: next })}
        >
          <span className={styles.hint}>{conformedHint(job)}</span>
        </DateField>
        <DateField
          label="WAPC outcome date"
          labelClassName={styles.title}
          value={outcomeDate}
          disabled={!canEdit}
          onCommit={(next) => update.mutateAsync({ outcomeDate: next })}
        >
          <span className={styles.hint}>
            {isAutomatic ? "90 days after the conformed date" : "Changed by hand (e.g. deferral)"}
            {!isAutomatic && conformedDate && canEdit && (
              <>
                {" "}
                <button
                  type="button"
                  className={styles.reset}
                  onClick={() => {
                    update.mutate({ outcomeDate: outcomeDateFor(conformedDate) });
                  }}
                >
                  · reset to 90 days
                </button>
              </>
            )}
          </span>
        </DateField>
      </div>
      <div className={styles.countdown} role="timer" aria-live="off" aria-label="Countdown to the WAPC outcome date">
        {outcomeDate ? (
          <Countdown outcomeDate={outcomeDate} />
        ) : (
          <div className={styles.empty}>
            Drop the Conformance Notification in 4.2, or enter the conformed date, to start the countdown
          </div>
        )}
      </div>
    </div>
  );
}
