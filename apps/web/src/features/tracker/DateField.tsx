"use client";
import { useState, type ReactNode } from "react";
import { cx } from "@/lib/cx";
import styles from "./DateField.module.css";

export interface DateFieldProps {
  readonly label: string;
  /** yyyy-mm-dd or null. */
  readonly value: string | null;
  readonly disabled: boolean;
  /** Save the new value (`null` when cleared). Failures are shown by the caller's mutation (banner), so a rejection only ends the draft. */
  readonly onCommit: (next: string | null) => Promise<unknown>;
  readonly className?: string;
  readonly labelClassName?: string;
  /** Id of the element under the input (status or hint) that describes it. */
  readonly describedBy?: string | undefined;
  /** Hint or status under the input; not part of the label's accessible name. */
  readonly children?: ReactNode;
}

/**
 * A labelled date input that shows what was picked at once and saves it. The draft lasts until the save settles, after
 * which the job's own value (the saved one, or the old one after a failure) is shown again.
 */
export function DateField({
  label,
  value,
  disabled,
  onCommit,
  className,
  labelClassName,
  describedBy,
  children,
}: DateFieldProps) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <div className={cx(styles.field, className)}>
      <label className={styles.control}>
        <span className={cx(styles.label, labelClassName)}>{label}</span>
        <input
          type="date"
          className={styles.input}
          disabled={disabled}
          aria-describedby={describedBy}
          value={draft ?? value ?? ""}
          onChange={(event) => {
            const next = event.target.value;
            if (next === (value ?? "")) return;
            setDraft(next);
            onCommit(next === "" ? null : next)
              .catch(() => undefined)
              .finally(() => {
                setDraft(null);
              });
          }}
        />
      </label>
      {children}
    </div>
  );
}
