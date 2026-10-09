"use client";
import type { Condition } from "@kr/contracts";
import { STAGES, type Agency } from "@kr/workflow";
import { GUESSED_BADGE, GUESSED_TITLE } from "./messages";
import styles from "./ConditionCard.module.css";

export interface ConditionCardProps {
  readonly condition: Condition;
  /** "checklist" in 5.0: "Go to <agency> ↓". "agency" in an agency stage: the plain agency badge only. */
  readonly variant: "checklist" | "agency";
}

/** The stage that holds the conditions of `agency` (the target of "Go to <agency> ↓"). */
function stageKeyOf(agency: Agency): string | undefined {
  return STAGES.find((stage) => stage.agency === agency)?.key;
}

/**
 * One condition (§5.6): "Condition N", its agency badge, the guessed badge, the link to the agency's stage, the text (struck through
 * once cleared) and the card colour (red open, green cleared). The checklist and the agency box render the same job.conditions entry.
 */
export function ConditionCard({ condition, variant }: ConditionCardProps) {
  const { agency } = condition;
  const stageKey = stageKeyOf(agency);
  return (
    <div
      className={styles.card}
      data-cleared={condition.isCleared}
      role="group"
      aria-label={
        variant === "checklist" ? `Condition ${condition.number}` : `Condition ${condition.number} – ${agency}`
      }
    >
      <div className={styles.head}>
        <span className={styles.number}>Condition {condition.number}</span>
        <span className={styles.agency}>{agency}</span>
        {condition.agencyGuessed && (
          <span className={styles.guess} title={GUESSED_TITLE}>
            {GUESSED_BADGE}
          </span>
        )}
        {variant === "checklist" && stageKey && (
          <a className={styles.goTo} href={`#${stageKey}`}>
            Go to {agency} ↓
          </a>
        )}
      </div>
      <div className={styles.text}>{condition.text}</div>
    </div>
  );
}
