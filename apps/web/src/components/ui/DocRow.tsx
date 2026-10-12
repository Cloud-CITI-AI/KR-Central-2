"use client";
import type { FileMeta } from "@kr/contracts";
import { useEffect, useRef, useState } from "react";
import { fileExtension, scanStateText } from "@/lib/files";
import { Button } from "./Button";
import { VisuallyHidden } from "./VisuallyHidden";
import styles from "./DocRow.module.css";

export interface DocRowProps {
  readonly file: FileMeta;
  /** Open the viewer on this file. Not offered for files that failed the virus scan. */
  readonly onOpen: (file: FileMeta) => void;
  /** Called after the inline "Remove? Yes / No" confirmation. The parent shows failures and drops the row. */
  readonly onRemove: (file: FileMeta) => void;
  /** The parent is deleting it: the controls are disabled. */
  readonly removing?: boolean;
}

/** One uploaded file: extension badge, name (opens the viewer), scan state, and × with inline confirmation. */
export function DocRow({ file, onOpen, onRemove, removing = false }: DocRowProps) {
  const [confirming, setConfirming] = useState(false);
  const removeButton = useRef<HTMLButtonElement>(null);
  const question = useRef<HTMLSpanElement>(null);
  const wasConfirming = useRef(false);
  const blocked = file.scanStatus === "infected" || file.scanStatus === "error";
  const stateText = scanStateText(file);

  useEffect(() => {
    // Asking moves focus to the safe answer (No); answering puts it back on the × that asked.
    if (confirming) question.current?.querySelector<HTMLElement>("[data-no]")?.focus();
    else if (wasConfirming.current) removeButton.current?.focus();
    wasConfirming.current = confirming;
  }, [confirming]);

  return (
    <li className={styles.doc}>
      <span className={styles.ext} aria-hidden="true">
        {fileExtension(file.name)}
      </span>
      {blocked ? (
        <span className={styles.blocked}>{file.name}</span>
      ) : (
        <button
          className={styles.name}
          onClick={() => {
            onOpen(file);
          }}
        >
          {file.name}
        </button>
      )}
      {stateText && (
        <span
          role="status"
          className={`${styles.state} ${file.scanStatus === "pending" || (file.scanStatus === "error" && !file.scanRetriesExhausted) ? styles.scanning : ""}`}
        >
          {stateText}
        </span>
      )}
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
            <VisuallyHidden>Remove {file.name}</VisuallyHidden>
            <span aria-hidden="true">×</span>
          </button>
        ))}
    </li>
  );
}
