import type { ReactNode } from "react";
import styles from "./PanelBox.module.css";

export interface PanelBoxProps {
  readonly children: ReactNode;
}

/** The white box a panel sits in, indented under the card title (0 indent below 760 px). */
export function PanelBox({ children }: PanelBoxProps) {
  return <div className={styles.box}>{children}</div>;
}
