"use client";
import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { cx } from "@/lib/cx";
import styles from "./DateField.module.css";

export interface DateFieldProps {
  readonly label: string;
  /** yyyy-mm-dd or null. */
  readonly value: string | null;
  readonly disabled: boolean;
  /** Save the new value (`null` when cleared). Failures are shown by the caller's mutation (banner), so a rejection only ends the draft. */
  readonly onCommit: (next: string | null) => Promise<unknown>;
  readonly className?: string | undefined;
  readonly labelClassName?: string | undefined;
  /** Id of the element under the input (status or hint) that describes it. */
  readonly describedBy?: string | undefined;
  /** Hint or status under the input; not part of the label's accessible name. */
  readonly children?: ReactNode;
}

/** Keys that edit the value one segment at a time: while they are in use the browser reports a date after each digit. */
const EDITING_KEYS = /^(\d|Backspace|Delete|ArrowUp|ArrowDown)$/;

/**
 * A labelled date input that shows what was entered at once and saves it. Typing by keyboard saves when the person leaves the
 * field or presses Enter (the browser reports 0002-06-14, 0020-06-14, 0202-06-14 on the way to 2026-06-14); picking from the
 * calendar or clearing saves at once. Only a changed value is saved. The draft lasts until the latest save settles, after which
 * the job's own value (the saved one, or the old one after a failure) is shown again.
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
  const typing = useRef(false);
  const pending = useRef(0);
  const latest = useRef(0);

  const commit = (input: HTMLInputElement) => {
    typing.current = false;
    const next = input.value;
    // An unfinished entry (a cleared segment) reads as "" with badInput: neither a save nor a clear.
    if (input.validity.badInput || next === (value ?? "")) {
      if (pending.current === 0) setDraft(null);
      return;
    }
    const id = ++latest.current;
    pending.current += 1;
    setDraft(next);
    onCommit(next === "" ? null : next)
      .catch(() => undefined)
      .finally(() => {
        pending.current -= 1;
        if (latest.current === id) setDraft(null);
      });
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") commit(event.currentTarget);
    else if (EDITING_KEYS.test(event.key)) typing.current = true;
  };

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
          onKeyDown={onKeyDown}
          onChange={(event) => {
            setDraft(event.target.value);
            if (!typing.current) commit(event.target);
          }}
          onBlur={(event) => {
            commit(event.currentTarget);
          }}
        />
      </label>
      {children}
    </div>
  );
}
