"use client";
import { outcomeCountdown } from "@kr/workflow";
import { useNow } from "./useNow";
import styles from "./OutcomeBox.module.css";

export interface CountdownProps {
  /** The WAPC outcome date (yyyy-mm-dd). */
  readonly outcomeDate: string;
}

const pad = (n: number): string => String(n).padStart(2, "0");

/**
 * The live countdown to the end of the outcome date (Perth), ticking every second from the injected clock (R12): days, hrs,
 * min and sec tiles (amber under 14 days, red once past) and the caption "until outcome date – Sun, 14 Jun 2026" or
 * "Outcome date passed – Sun, 14 Jun 2026".
 */
export function Countdown({ outcomeDate }: CountdownProps) {
  const countdown = outcomeCountdown(outcomeDate, useNow(1000));
  return (
    <div className={styles.cd} data-state={countdown.state}>
      <div className={styles.digits}>
        <span>
          <b>{countdown.days}</b>
          <i>{countdown.days === 1 ? "day" : "days"}</i>
        </span>
        <span>
          <b>{pad(countdown.hours)}</b>
          <i>hrs</i>
        </span>
        <span>
          <b>{pad(countdown.minutes)}</b>
          <i>min</i>
        </span>
        <span>
          <b>{pad(countdown.seconds)}</b>
          <i>sec</i>
        </span>
      </div>
      <div className={styles.caption}>{countdown.caption}</div>
    </div>
  );
}
