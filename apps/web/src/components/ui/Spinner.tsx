import { VisuallyHidden } from "./VisuallyHidden";
import styles from "./Spinner.module.css";

export interface SpinnerProps {
  /** Announced to screen readers. */
  readonly label?: string;
}

/** Busy indicator with a status role; the ring stops turning under `prefers-reduced-motion`. */
export function Spinner({ label = "Loading…" }: SpinnerProps) {
  return (
    <span role="status">
      <span className={styles.ring} aria-hidden="true" />
      <VisuallyHidden>{label}</VisuallyHidden>
    </span>
  );
}
