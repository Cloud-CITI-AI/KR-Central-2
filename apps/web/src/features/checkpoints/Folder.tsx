import type { ReactNode } from "react";
import { cx } from "@/lib/cx";
import styles from "./Folder.module.css";

export interface FolderProps {
  /** A sub-folder of a slots panel: a rule above it and an upper-case title. */
  readonly slot?: boolean;
  readonly children: ReactNode;
}

/** One folder of a panel: header, files and drop zone, 6 px apart. */
export function Folder({ slot = false, children }: FolderProps) {
  return <div className={cx(styles.folder, slot && styles.slot)}>{children}</div>;
}

export interface FolderHeaderProps {
  readonly title: string;
  /** "2 files", "empty", "not received yet". */
  readonly count: string;
  /** The "Open all" button, at the right. */
  readonly action?: ReactNode;
}

/** Folder icon, bold title, count and an optional button at the right. */
export function FolderHeader({ title, count, action }: FolderHeaderProps) {
  return (
    <div className={styles.head}>
      <span className={styles.icon} aria-hidden="true" />
      <b>{title}</b>
      <span className={styles.count}>{count}</span>
      {action && <span className={styles.action}>{action}</span>}
    </div>
  );
}

export interface SlotTitleProps {
  readonly children: ReactNode;
}

/** Upper-case title of a slot's sub-folder. */
export function SlotTitle({ children }: SlotTitleProps) {
  return <div className={styles.slotTitle}>{children}</div>;
}

export interface FolderHintProps {
  readonly children: ReactNode;
}

/** The grey line under an empty folder's header (what goes here). */
export function FolderHint({ children }: FolderHintProps) {
  return <p className={styles.hint}>{children}</p>;
}
