"use client";
import type { ReactNode } from "react";
import { Button } from "./Button";
import { Dialog } from "./Dialog";
import styles from "./ConfirmDialog.module.css";

export interface ConfirmDialogProps {
  readonly open: boolean;
  readonly title: string;
  /** The question, e.g. "Archive S-0001? It disappears from the dashboard …". */
  readonly children: ReactNode;
  /** Upper-case verb from the spec, e.g. "ARCHIVE" or "Replace". */
  readonly confirmLabel: string;
  readonly cancelLabel?: string;
  /** Disables Confirm while the action runs. */
  readonly busy?: boolean;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

/** Confirm / Cancel modal. Cancel has initial focus so a stray Enter never confirms a destructive action. */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  cancelLabel = "Cancel",
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Dialog open={open} onClose={onCancel} title={title} size="small">
      <p className={styles.message}>{children}</p>
      <div className={styles.actions}>
        <Button variant="primary" disabled={busy} onClick={onConfirm}>
          {confirmLabel}
        </Button>
        <Button data-autofocus onClick={onCancel}>
          {cancelLabel}
        </Button>
      </div>
    </Dialog>
  );
}
