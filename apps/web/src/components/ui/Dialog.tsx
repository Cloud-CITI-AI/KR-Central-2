"use client";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { cx } from "@/lib/cx";
import { Button } from "./Button";
import styles from "./Dialog.module.css";

export interface DialogProps {
  readonly open: boolean;
  /** Called for the Close button and for Esc. The parent then sets `open` to false. */
  readonly onClose: () => void;
  readonly title: ReactNode;
  readonly children: ReactNode;
  /** `viewer` is the fixed-height body of the document viewer. */
  readonly size?: "default" | "small" | "viewer";
  readonly closeLabel?: string;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Modal built on the native `<dialog>` (§11.1): `showModal()` makes the page inert and Esc closes it. On top of that
 * Tab wraps inside the dialog, the element marked `data-autofocus` (else the first control) gets focus, and focus returns
 * to the control that opened it. Children are mounted only while open so their state resets.
 */
export function Dialog({ open, onClose, title, children, size = "default", closeLabel = "Close" }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      dialog.showModal();
      (dialog.querySelector<HTMLElement>("[data-autofocus]") ?? dialog.querySelector<HTMLElement>(FOCUSABLE))?.focus();
    } else if (!open) {
      if (dialog.open) dialog.close();
      if (opener.current?.isConnected) opener.current.focus();
      opener.current = null;
    }
  }, [open]);

  // Tab wraps inside the dialog (listener, not a JSX prop: a <dialog> is not an interactive element for jsx-a11y).
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const trapTab = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const focusable = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)];
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    dialog.addEventListener("keydown", trapTab);
    return () => {
      dialog.removeEventListener("keydown", trapTab);
    };
  }, []);

  return (
    <dialog
      ref={ref}
      className={cx(styles.dialog, size === "small" && styles.small, size === "viewer" && styles.viewer)}
      aria-labelledby={titleId}
      onClose={() => {
        // Esc (or the browser) closed it: tell the parent, unless the parent already did.
        if (open) onClose();
      }}
    >
      <div className={styles.head}>
        <h2 id={titleId} className={styles.title}>
          {title}
        </h2>
        <Button small onClick={onClose}>
          {closeLabel}
        </Button>
      </div>
      <div className={styles.body}>{open && children}</div>
    </dialog>
  );
}
