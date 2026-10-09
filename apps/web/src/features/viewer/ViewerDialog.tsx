"use client";
import type { FileMeta } from "@kr/contracts";
import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/Button";
import buttonStyles from "@/components/ui/Button.module.css";
import { Dialog } from "@/components/ui/Dialog";
import { cx } from "@/lib/cx";
import { contentUrl, opensInTab, viewFor } from "./content";
import { VIEWER_MESSAGES } from "./messages";
import { ViewerBody } from "./ViewerBody";
import styles from "./ViewerDialog.module.css";

export interface ViewerDialogProps {
  readonly open: boolean;
  readonly files: readonly FileMeta[];
  readonly index: number;
  readonly onIndexChange: (index: number) => void;
  readonly onClose: () => void;
}

/**
 * The document viewer (§11.1): the shared `Dialog` (`size="viewer"`: modal, focus trap, Esc, focus returned to the opener)
 * with ‹ / › (when there are several files), the file name, "1 of 2" and "Open in new tab" in its header slots. The body
 * is mounted only while open, so each opening starts clean.
 */
export function ViewerDialog({ open, files, index, onIndexChange, onClose }: ViewerDialogProps) {
  const nav = useRef<HTMLSpanElement>(null);
  const file = files[index];
  const several = files.length > 1;

  useEffect(() => {
    // A button that just became disabled (the first or last file reached) loses focus: hand it to its partner.
    const active = document.activeElement;
    if (active instanceof HTMLButtonElement && active.disabled && nav.current?.contains(active)) {
      const other = active.dataset.nav === "previous" ? "next" : "previous";
      nav.current.querySelector<HTMLElement>(`[data-nav="${other}"]`)?.focus();
    }
  }, [index]);

  if (!file) return null;
  const view = viewFor(file);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={file.name}
      size="viewer"
      autoFocusClose
      headerStart={
        several && (
          <span ref={nav} className={styles.nav}>
            <Button
              data-nav="previous"
              small
              aria-label="Previous file"
              disabled={index === 0}
              onClick={() => {
                onIndexChange(index - 1);
              }}
            >
              ‹
            </Button>
            <Button
              data-nav="next"
              small
              aria-label="Next file"
              disabled={index === files.length - 1}
              onClick={() => {
                onIndexChange(index + 1);
              }}
            >
              ›
            </Button>
          </span>
        )
      }
      headerEnd={
        <>
          {several && (
            <span className={styles.position} aria-live="polite">
              {index + 1} of {files.length}
            </span>
          )}
          {opensInTab(view) && (
            <a
              className={cx(buttonStyles.btn, buttonStyles.small)}
              href={contentUrl(file.id)}
              target="_blank"
              rel="noopener noreferrer"
            >
              {VIEWER_MESSAGES.openInNewTab}
            </a>
          )}
        </>
      }
    >
      <ViewerBody key={file.id} file={file} />
    </Dialog>
  );
}
