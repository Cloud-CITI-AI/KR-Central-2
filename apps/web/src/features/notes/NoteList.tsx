"use client";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { ApiProblem } from "@/lib/api";
import { NOTES_MESSAGES } from "./messages";
import { NoteRow } from "./NoteRow";
import { useNotes } from "./queries";
import styles from "./NoteList.module.css";

export interface NoteListProps {
  readonly jobId: string;
}

/** The job's notes, newest first, with "Load more" past the first 50. */
export function NoteList({ jobId }: NoteListProps) {
  const notes = useNotes(jobId);
  if (notes.isError && !notes.data) {
    const requestId = notes.error instanceof ApiProblem ? notes.error.requestId : "";
    return (
      <p role="alert" className={styles.error}>
        {NOTES_MESSAGES.loadFailed}
        {requestId && ` (Request ID: ${requestId})`}
      </p>
    );
  }
  if (!notes.data) return null;
  const rows = notes.data.pages.flatMap((page) => page.items);
  if (rows.length === 0) return <EmptyState>{NOTES_MESSAGES.empty}</EmptyState>;
  return (
    <>
      <ol className={styles.list}>
        {rows.map((note) => (
          <NoteRow key={note.id} note={note} />
        ))}
      </ol>
      {notes.hasNextPage && (
        <Button
          small
          disabled={notes.isFetchingNextPage}
          onClick={() => {
            void notes.fetchNextPage();
          }}
        >
          Load more
        </Button>
      )}
    </>
  );
}
