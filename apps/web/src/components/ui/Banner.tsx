import type { ReactNode } from "react";
import { Button } from "./Button";
import styles from "./Banner.module.css";

export interface BannerProps {
  readonly children: ReactNode;
  /** When given, a "Dismiss" button is shown. */
  readonly onDismiss?: () => void;
}

/** Prototype `.banner`: accent-soft notice under the header (read-only, save failure, stale data). */
export function Banner({ children, onDismiss }: BannerProps) {
  return (
    <div className={styles.banner}>
      <p className={styles.text}>{children}</p>
      {onDismiss && (
        <Button small onClick={onDismiss}>
          Dismiss
        </Button>
      )}
    </div>
  );
}
