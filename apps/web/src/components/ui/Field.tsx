import { useId, type ReactNode } from "react";
import styles from "./Field.module.css";

/** Props to spread on the control inside a Field so it is labelled, described and flagged invalid. */
export interface FieldControlProps {
  readonly id: string;
  readonly "aria-describedby": string | undefined;
  readonly "aria-invalid": true | undefined;
}

export interface FieldProps {
  /** Small upper-case label (prototype field label: 11 px, .07em, `--ink-3`). */
  readonly label: ReactNode;
  readonly hint?: ReactNode;
  /** Shown in red and announced; marks the control invalid. */
  readonly error?: ReactNode;
  /** Render the control with the given props: `{(c) => <Input {...c} />}`. */
  readonly children: (control: FieldControlProps) => ReactNode;
}

/** A label, a control and its hint and error, wired together with ids (every input has a programmatic label, FE-7). */
export function Field({ label, hint, error, children }: FieldProps) {
  const id = useId();
  const describedBy = [hint ? `${id}-hint` : "", error ? `${id}-error` : ""].filter(Boolean).join(" ");
  return (
    <div className={styles.field}>
      <label htmlFor={id} className={styles.label}>
        {label}
      </label>
      {children({ id, "aria-describedby": describedBy || undefined, "aria-invalid": error ? true : undefined })}
      {hint && (
        <p id={`${id}-hint`} className={styles.hint}>
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className={styles.error} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
