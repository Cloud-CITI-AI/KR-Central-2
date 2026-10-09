"use client";
import type { JobDetail } from "@kr/contracts";
import { useState } from "react";
import { cx } from "@/lib/cx";
import { ConditionCard } from "./ConditionCard";
import { clearedText, extractedFromText } from "./messages";
import styles from "./Conditions.module.css";

export interface ConditionsChecklistProps {
  readonly job: JobDetail;
}

/** The conditions checklist of 5.0 (§5.5): a <details> open by default, "5 of 13 cleared", one card per condition, and where they came from. */
export function ConditionsChecklist({ job }: ConditionsChecklistProps) {
  const [open, setOpen] = useState(true);
  const { conditions, conditionsSource } = job;
  if (conditions.length === 0) return null;
  const cleared = conditions.filter((c) => c.isCleared).length;
  return (
    <details
      className={styles.checklist}
      open={open}
      onToggle={(event) => {
        setOpen(event.currentTarget.open);
      }}
    >
      <summary className={styles.summary}>
        <b>Conditions checklist</b>
        <span className={styles.count}>{clearedText(cleared, conditions.length)}</span>
      </summary>
      <div className={styles.list}>
        {conditions.map((condition) => (
          <ConditionCard key={condition.id} condition={condition} variant="checklist" />
        ))}
      </div>
      {conditionsSource && <p className={cx(styles.msg, styles.ok)}>{extractedFromText(conditionsSource.fileName)}</p>}
    </details>
  );
}
