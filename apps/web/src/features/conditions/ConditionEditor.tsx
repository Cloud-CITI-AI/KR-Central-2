"use client";
import type { Condition } from "@kr/contracts";
import { CONDITION_RESPONSIBILITIES, RESPONSIBILITY_LABELS } from "@kr/workflow";
import { Select } from "@/components/ui/Select";
import { VisuallyHidden } from "@/components/ui/VisuallyHidden";
import type { ConditionPermissions } from "./capabilities";
import type { UpdateConditionBody } from "./cache";
import styles from "./ConditionCard.module.css";

export interface ConditionEditorProps {
  readonly condition: Condition;
  readonly permissions: ConditionPermissions;
  /** Saves one change; resolves when the write is over, whether it worked or was rolled back. */
  readonly save: (body: UpdateConditionBody) => Promise<unknown>;
}

/**
 * The editor row of a condition card (§5.6): the cleared tick ("Open" / "Cleared") and the responsibility select (Unassigned /
 * KR Surveys / Client). Both are disabled without `conditions.edit`.
 */
export function ConditionEditor({ condition, permissions, save }: ConditionEditorProps) {
  const { number } = condition;
  return (
    <div className={styles.editor}>
      <div className={styles.tools}>
        <label className={styles.tick}>
          <input
            type="checkbox"
            checked={condition.isCleared}
            disabled={!permissions.edit}
            onChange={(event) => {
              void save({ isCleared: event.target.checked });
            }}
          />
          <VisuallyHidden>Condition {number}:</VisuallyHidden>{" "}
          <span className={styles.state}>{condition.isCleared ? "Cleared" : "Open"}</span>
        </label>
        <span className={styles.label}>Responsibility</span>
        <Select
          className={styles.responsibility}
          aria-label={`Responsibility for condition ${number}`}
          disabled={!permissions.edit}
          value={condition.responsibility ?? ""}
          onChange={(event) => {
            const value = event.target.value;
            void save({ responsibility: CONDITION_RESPONSIBILITIES.find((r) => r === value) ?? null });
          }}
        >
          <option value="">{RESPONSIBILITY_LABELS.unassigned}</option>
          {CONDITION_RESPONSIBILITIES.map((responsibility) => (
            <option key={responsibility} value={responsibility}>
              {RESPONSIBILITY_LABELS[responsibility]}
            </option>
          ))}
        </Select>
      </div>
    </div>
  );
}
