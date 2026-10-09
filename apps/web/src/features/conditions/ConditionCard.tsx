"use client";
import type { Condition, JobDetail } from "@kr/contracts";
import { STAGES, type Agency } from "@kr/workflow";
import { conditionPermissions } from "./capabilities";
import { AgencyPicker } from "./AgencyPicker";
import { ConditionEditor } from "./ConditionEditor";
import { GUESSED_BADGE, GUESSED_TITLE } from "./messages";
import { useUpdateCondition } from "./useUpdateCondition";
import styles from "./ConditionCard.module.css";

export interface ConditionCardProps {
  readonly job: JobDetail;
  readonly condition: Condition;
  /** "checklist" in 5.0: agency select and "Go to <agency> ↓". "agency" in an agency stage: plain agency badge. */
  readonly variant: "checklist" | "agency";
}

/** The stage that holds the conditions of `agency` (the target of "Go to <agency> ↓"). */
function stageKeyOf(agency: Agency): string | undefined {
  return STAGES.find((stage) => stage.agency === agency)?.key;
}

/**
 * One condition (§5.6): "Condition N", its agency (a select in the checklist, a badge in the agency boxes), the guessed badge,
 * the text (struck through once cleared), the editor row and the card colour (red open, green cleared). The checklist and the agency
 * box render the same job.conditions entry through the same cache write, so an edit in one shows in the other at once.
 */
export function ConditionCard({ job, condition, variant }: ConditionCardProps) {
  const update = useUpdateCondition(job.id, condition.id);
  const permissions = conditionPermissions(job.capabilities);
  const { agency } = condition;
  const stageKey = stageKeyOf(agency);
  const save = (body: Parameters<typeof update.mutateAsync>[0]) => update.mutateAsync(body).catch(() => undefined);
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
        {variant === "checklist" && permissions.edit ? (
          <AgencyPicker
            condition={condition}
            onChange={(next) => {
              void save({ agency: next });
            }}
            onConfirm={() => {
              void save({ agencyConfirmed: true });
            }}
          />
        ) : (
          <span className={styles.agency}>{agency}</span>
        )}
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
      <ConditionEditor condition={condition} permissions={permissions} save={save} />
    </div>
  );
}
