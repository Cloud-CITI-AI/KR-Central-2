import type { ReactNode } from "react";
import styles from "./EmptyState.module.css";

export interface EmptyStateProps {
  readonly children: ReactNode;
}

/** Quiet text for a list with nothing in it ("No one has been added yet.", "none yet"). */
export function EmptyState({ children }: EmptyStateProps) {
  return <p className={styles.empty}>{children}</p>;
}
