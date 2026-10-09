"use client";
import { formatPerthDateTime } from "@/features/admin/format";
import { AUDIENCE_LABELS } from "./messages";
import type { Note } from "./types";
import styles from "./NoteList.module.css";

export interface NoteRowProps {
  readonly note: Note;
}

/** One note: Perth date-time, audience chip (a label only: everyone reads every note) and "by you" / "by <name>". */
export function NoteRow({ note }: NoteRowProps) {
  const by = note.isOwn ? "by you" : note.author ? `by ${note.author.displayName}` : null;
  return (
    <li className={styles.note}>
      <div className={styles.meta}>
        <time dateTime={note.createdAt}>{formatPerthDateTime(note.createdAt)}</time>
        <span className={styles.audience} data-audience={note.audience}>
          {AUDIENCE_LABELS[note.audience]}
        </span>
        {by && <span>{by}</span>}
      </div>
      <div className={styles.text}>{note.body}</div>
    </li>
  );
}
