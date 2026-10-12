"use client";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { focusAfterRemoval } from "@/components/ui/focusAfterRemoval";
import { VisuallyHidden } from "@/components/ui/VisuallyHidden";
import { formatPerthDateTime } from "@/features/admin/format";
import { AUDIENCE_LABELS, NOTES_MESSAGES } from "./messages";
import { useDeleteNote } from "./queries";
import type { Note } from "./types";
import styles from "./NoteList.module.css";

export interface NoteRowProps {
  readonly jobId: string;
  readonly note: Note;
}

/** One note: Perth date-time, audience chip (a label only), "by you" / "by <name>", and × with "Delete? Yes / No". */
export function NoteRow({ jobId, note }: NoteRowProps) {
  const remove = useDeleteNote(jobId);
  const [confirming, setConfirming] = useState(false);
  const row = useRef<HTMLLIElement>(null);
  const removeButton = useRef<HTMLButtonElement>(null);
  const question = useRef<HTMLSpanElement>(null);
  const wasConfirming = useRef(false);
  /** Yes was pressed: focus went to a neighbouring note (this one is about to go), so it must not return to ×. */
  const removed = useRef(false);

  useEffect(() => {
    // Asking moves focus to the safe answer (No); answering No puts it back on the × that asked, answering Yes moves it to the next note.
    if (confirming) {
      removed.current = false;
      question.current?.querySelector<HTMLElement>("[data-no]")?.focus();
    } else if (wasConfirming.current && !removed.current) removeButton.current?.focus();
    wasConfirming.current = confirming;
  }, [confirming]);

  const by = note.isOwn ? "by you" : note.author ? `by ${note.author.displayName}` : null;
  return (
    <li ref={row} className={styles.note}>
      <div className={styles.meta}>
        <time dateTime={note.createdAt}>{formatPerthDateTime(note.createdAt)}</time>
        <span className={styles.audience} data-audience={note.audience}>
          {AUDIENCE_LABELS[note.audience]}
        </span>
        {by && <span>{by}</span>}
        {remove.isError && (
          <span role="alert" className={styles.failed}>
            {NOTES_MESSAGES.deleteFailed}
          </span>
        )}
        {note.canDelete &&
          (confirming ? (
            <span ref={question} className={styles.confirm}>
              Delete?
              <Button
                small
                onClick={() => {
                  removed.current = true;
                  if (row.current) focusAfterRemoval(row.current);
                  setConfirming(false);
                  remove.mutate(note);
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
              type="button"
              className={styles.remove}
              disabled={remove.isPending}
              onClick={() => {
                setConfirming(true);
              }}
            >
              <VisuallyHidden>Delete note</VisuallyHidden>
              <span aria-hidden="true">×</span>
            </button>
          ))}
      </div>
      <div className={styles.text}>{note.body}</div>
    </li>
  );
}
