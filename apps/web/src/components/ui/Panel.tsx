import { useId, type ReactNode } from "react";
import styles from "./Panel.module.css";

export interface PanelProps {
  /** Upper-case heading with the accent underline (an `h2`). */
  readonly title?: ReactNode;
  readonly children: ReactNode;
}

/** Prototype `.panel`: white box with a titled section heading. */
export function Panel({ title, children }: PanelProps) {
  const titleId = useId();
  return (
    <section className={styles.panel} aria-labelledby={title ? titleId : undefined}>
      {title && (
        <h2 id={titleId} className={styles.title}>
          {title}
        </h2>
      )}
      {children}
    </section>
  );
}
