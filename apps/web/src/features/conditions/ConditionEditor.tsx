"use client";
import type { Condition } from "@kr/contracts";
import { CONDITION_RESPONSIBILITIES, RESPONSIBILITY_LABELS } from "@kr/workflow";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { VisuallyHidden } from "@/components/ui/VisuallyHidden";
import type { ConditionPermissions } from "./capabilities";
import { useAutosaveText } from "@/features/checkpoints";
import type { UpdateConditionBody } from "./cache";
import styles from "./ConditionCard.module.css";

export interface ConditionEditorProps {
  readonly condition: Condition;
  readonly permissions: ConditionPermissions;
  /** Saves one change; resolves when the write is over, whether it worked or was rolled back. */
  readonly save: (body: UpdateConditionBody) => Promise<unknown>;
}

interface CommentFieldProps {
  readonly label: string;
  readonly number: number;
  readonly value: string;
  readonly editable: boolean;
  readonly onSave: (text: string) => Promise<unknown>;
}

/** One comment: autosaves 700 ms after typing and on blur, and is never replaced under the cursor (§5.6, §15). */
function CommentField({ label, number, value, editable, onSave }: CommentFieldProps) {
  const field = useAutosaveText({ value, onSave });
  return (
    <label className={styles.field}>
      <span className={styles.label}>{label}</span>
      <Textarea
        className={styles.comment}
        rows={2}
        maxLength={4000}
        placeholder={label}
        aria-label={`${label} – condition ${number}`}
        readOnly={!editable}
        value={field.text}
        onChange={field.onChange}
        onFocus={field.onFocus}
        onBlur={field.onBlur}
      />
    </label>
  );
}

/**
 * The editor row of a condition card (§5.6): the cleared tick ("Open" / "Cleared"), the responsibility select, and the KR
 * Surveys and client comments side by side (stacked below 640 px). Without `conditions.edit` only the client comment can change.
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
      <div className={styles.fields}>
        <CommentField
          label="KR Surveys comment"
          number={number}
          value={condition.krComment}
          editable={permissions.edit}
          onSave={(krComment) => save({ krComment })}
        />
        <CommentField
          label="Client comment"
          number={number}
          value={condition.clientComment}
          editable={permissions.comment}
          onSave={(clientComment) => save({ clientComment })}
        />
      </div>
    </div>
  );
}
