"use client";
import type { JobDetail } from "@kr/contracts";
import { CONDITIONAL_APPROVAL_CHECKPOINT_KEY, getCheckpoint, type Agency } from "@kr/workflow";
import { useId } from "react";
import { ConditionCard } from "./ConditionCard";
import { clearedText } from "./messages";
import styles from "./AgencyConditions.module.css";

export interface AgencyConditionsProps {
  readonly job: JobDetail;
  readonly agency: Agency;
}

/** The stage of the checklist (5.0): the target of "Checklist ↑". */
const CHECKLIST_STAGE = getCheckpoint(CONDITIONAL_APPROVAL_CHECKPOINT_KEY).stage;

/**
 * "WAPC conditions – <agency>" evidence box shown first inside an agency stage (and WAPC) when that agency has conditions;
 * renders nothing otherwise (§5.3, §5.6). It shows the same conditions as the 5.0 checklist, through the same cards and the same
 * cache write, so an edit in one place shows in the other at once. The agency is a plain badge here (it is changed in the checklist).
 */
export function AgencyConditions({ job, agency }: AgencyConditionsProps) {
  const headingId = useId();
  const mine = job.conditions.filter((c) => c.agency === agency);
  if (mine.length === 0) return null;
  const cleared = mine.filter((c) => c.isCleared).length;
  return (
    <div className={styles.box} role="group" aria-labelledby={headingId}>
      <div className={styles.head}>
        <b id={headingId}>WAPC conditions – {agency}</b>
        <span className={styles.count}>{clearedText(cleared, mine.length)}</span>
        <a className={styles.up} href={`#${CHECKLIST_STAGE}`}>
          Checklist ↑
        </a>
      </div>
      {mine.map((condition) => (
        <ConditionCard key={condition.id} job={job} condition={condition} variant="agency" />
      ))}
    </div>
  );
}
