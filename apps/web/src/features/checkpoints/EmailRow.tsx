"use client";
import type { FileMeta } from "@kr/contracts";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { VisuallyHidden } from "@/components/ui/VisuallyHidden";
import { formatInstantDateTime } from "./dateTime";
import { scanStateText } from "./messages";
import styles from "./Emails.module.css";

export interface EmailRowProps {
  readonly file: FileMeta;
  readonly onOpen: (file: FileMeta) => void;
  /** Called after the inline "Remove? Yes / No" confirmation. */
  readonly onRemove: (file: FileMeta) => void;
  readonly removing: boolean;
}

/**
 * "From · 28 Sep 2026, 3:50 pm" (§5.5): the sender (or "Pasted text") and the email's own date. An email with no Date header (an .eml
 * without one, a .msg without a submit or delivery time) has no date to show: the time it was uploaded is not the email's date.
 */
function metaLine(file: FileMeta): string {
  const { email } = file;
  const from = email?.from ?? (email?.isPasted ? "Pasted text" : null);
  return [from, email?.sentAt ? formatInstantDateTime(email.sentAt) : null].filter(Boolean).join(" · ");
}

/** The line that replaces the meta while the email cannot be shown yet, or at all. */
function stateText(file: FileMeta): string | null {
  const scan = scanStateText(file);
  if (scan !== undefined) return scan;
  if (file.email?.parseStatus === "pending") return "Reading the email…";
  if (file.email?.parseStatus === "failed") return "Couldn't be read as an email – remove it and drop it again";
  return null;
}

/** One query email: the subject opens the viewer (the rendered text), the meta line, and × with inline confirmation. */
export function EmailRow({ file, onOpen, onRemove, removing }: EmailRowProps) {
  const [confirming, setConfirming] = useState(false);
  const removeButton = useRef<HTMLButtonElement>(null);
  const question = useRef<HTMLSpanElement>(null);
  const wasConfirming = useRef(false);
  const blocked = file.scanStatus === "infected" || file.scanStatus === "error";
  const sentSubject = file.email?.subject?.trim();
  const subject = sentSubject === undefined || sentSubject === "" ? file.name : sentSubject;
  const state = stateText(file);

  useEffect(() => {
    // Asking moves focus to the safe answer (No); answering puts it back on the × that asked.
    if (confirming) question.current?.querySelector<HTMLElement>("[data-no]")?.focus();
    else if (wasConfirming.current) removeButton.current?.focus();
    wasConfirming.current = confirming;
  }, [confirming]);

  return (
    <li className={styles.mail}>
      {blocked ? (
        <span className={styles.blocked}>{subject}</span>
      ) : (
        <button
          className={styles.nm}
          onClick={() => {
            onOpen(file);
          }}
        >
          {subject}
        </button>
      )}
      <div className={styles.meta}>
        {state ? (
          <span
            role="status"
            className={file.scanStatus === "infected" || file.scanStatus === "error" ? styles.bad : ""}
          >
            {state}
          </span>
        ) : (
          metaLine(file)
        )}
      </div>
      {file.canDelete &&
        (confirming ? (
          <span ref={question} className={styles.confirm}>
            Remove?
            <Button
              small
              disabled={removing}
              onClick={() => {
                setConfirming(false);
                onRemove(file);
              }}
            >
              Yes
            </Button>
            <Button
              small
              data-no
              onClick={() => {
                setConfirming(false);
              }}
            >
              No
            </Button>
          </span>
        ) : (
          <button
            ref={removeButton}
            className={styles.remove}
            disabled={removing}
            onClick={() => {
              setConfirming(true);
            }}
          >
            <VisuallyHidden>Remove {subject}</VisuallyHidden>
            <span aria-hidden="true">×</span>
          </button>
        ))}
    </li>
  );
}
