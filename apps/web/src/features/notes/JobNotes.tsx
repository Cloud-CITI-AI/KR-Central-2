"use client";
import type { JobCapability } from "@kr/contracts";
import dynamic from "next/dynamic";
import { NOTES_MESSAGES } from "./messages";
import { NoteList } from "./NoteList";
import styles from "./JobNotes.module.css";

// The form validates with the contract's schema (Zod), below the fold: loaded on demand, out of the tracker's first load (FE-9).
const NoteForm = dynamic(() => import("./NoteForm").then((module) => module.NoteForm));

export interface JobNotesProps {
  readonly jobId: string;
  readonly capabilities: readonly JobCapability[];
}

/**
 * "JOB NOTES" (§5.7), placed by the tracker after the stages. Everyone with the job reads every note; the audience
 * select is a label. Posting needs `notes.create`; the × on a note comes from the API (own note, or `notes.delete.any`).
 */
export function JobNotes({ jobId, capabilities }: JobNotesProps) {
  return (
    <section className={styles.box} aria-labelledby="job-notes-title">
      <div className={styles.head}>
        <h2 id="job-notes-title" className={styles.title}>
          {NOTES_MESSAGES.title}
        </h2>
        <p className={styles.text}>{NOTES_MESSAGES.description}</p>
      </div>
      {capabilities.includes("notes.create") && <NoteForm jobId={jobId} />}
      <NoteList jobId={jobId} />
    </section>
  );
}
