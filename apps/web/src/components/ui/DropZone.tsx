"use client";
import { useEffect, useEffectEvent, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { cx } from "@/lib/cx";
import { validateFiles, type FileRejection, type FileRules } from "@/lib/files";
import styles from "./DropZone.module.css";

export interface DropZoneProps extends FileRules {
  /** Bold line, e.g. "Drag and drop the WAPC conditional approval PDF here". */
  readonly label: ReactNode;
  /** Second line, e.g. "PDF – or click to choose". */
  readonly hint?: ReactNode;
  /** Receives only the files that passed the client-side checks. */
  readonly onFiles: (files: File[]) => void;
  readonly small?: boolean;
  /** Replaces the bold line with "Uploading…" (the hint stays) and blocks new files. */
  readonly busy?: boolean;
  readonly disabled?: boolean;
}

/**
 * Dashed upload target (§5.5): drag and drop, or click / keyboard to choose through a visually hidden, labelled
 * `<input type=file>`. Oversized or wrong-type files are listed under the zone with the spec's texts.
 */
export function DropZone({ label, hint, onFiles, small, busy, disabled, ...rules }: DropZoneProps) {
  const [over, setOver] = useState(false);
  const [rejected, setRejected] = useState<readonly FileRejection[]>([]);
  const inactive = disabled === true || busy === true;
  const multiple = rules.multiple ?? true;

  function receive(files: readonly File[]) {
    const result = validateFiles(files, rules);
    setRejected(result.rejected);
    if (result.accepted.length > 0) onFiles(result.accepted);
  }

  function onChange(event: ChangeEvent<HTMLInputElement>) {
    if (inactive) return;
    receive([...(event.target.files ?? [])]);
    event.target.value = ""; // choosing the same file again must fire a change
  }

  // Drag events go on the element itself (a <label> is not an interactive element for jsx-a11y).
  const zone = useRef<HTMLLabelElement>(null);
  const dragOver = useEffectEvent((event: DragEvent) => {
    if (inactive) return;
    event.preventDefault();
    setOver(true);
  });
  const drop = useEffectEvent((event: DragEvent) => {
    event.preventDefault();
    setOver(false);
    if (!inactive && event.dataTransfer) receive([...event.dataTransfer.files]);
  });
  useEffect(() => {
    const element = zone.current;
    if (!element) return;
    const leave = () => {
      setOver(false);
    };
    element.addEventListener("dragover", dragOver);
    element.addEventListener("dragleave", leave);
    element.addEventListener("drop", drop);
    return () => {
      element.removeEventListener("dragover", dragOver);
      element.removeEventListener("dragleave", leave);
      element.removeEventListener("drop", drop);
    };
  }, []);

  return (
    <div>
      <label
        ref={zone}
        className={cx(
          styles.drop,
          small && styles.small,
          over && styles.over,
          disabled === true && styles.disabled,
          busy === true && styles.busy,
        )}
      >
        <input
          className={styles.input}
          type="file"
          multiple={multiple}
          accept={rules.accept?.join(",")}
          disabled={inactive}
          onChange={onChange}
        />
        <b role="status">{busy ? "Uploading…" : label}</b>
        {hint ? <span>{hint}</span> : null}
      </label>
      <ul className={styles.messages} aria-live="polite">
        {rejected.map(({ file, message }) => (
          <li key={`${file.name}-${file.size}-${message}`}>{message}</li>
        ))}
      </ul>
    </div>
  );
}
