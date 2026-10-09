import type { ReactNode } from "react";
import styles from "./VisuallyHidden.module.css";

export interface VisuallyHiddenProps {
  readonly children: ReactNode;
}

/** Text for screen readers only. */
export function VisuallyHidden({ children }: VisuallyHiddenProps) {
  return <span className={styles.hidden}>{children}</span>;
}
