import { useId, type ReactNode } from "react";
import styles from "./Panel.module.css";

export interface PanelProps {
  /** The section label (an `h2`, or the page's `h1` with `headingLevel={1}`). */
  readonly title?: ReactNode;
  /** 1 when this panel's title is the page's only heading (status pages inside the shell). Default 2. */
  readonly headingLevel?: 1 | 2;
  readonly children: ReactNode;
  /** An extra class for the panel box itself, for the few panels that lay their own content out (the status key's grid). */
  readonly className?: string | undefined;
}

/** Prototype `.panel`: white box with a titled section heading. */
export function Panel({ title, children, className, headingLevel = 2 }: PanelProps) {
  const titleId = useId();
  const Heading = headingLevel === 1 ? "h1" : "h2";
  return (
    <section
      className={className ? `${styles.panel} ${className}` : styles.panel}
      aria-labelledby={title ? titleId : undefined}
    >
      {title && (
        <Heading id={titleId} className={styles.title}>
          {title}
        </Heading>
      )}
      {children}
    </section>
  );
}
