"use client";
import { CreateNoteRequest } from "@kr/contracts";
import { useRef, useState, type SubmitEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { ApiProblem, draftKey, useDraft } from "@/lib/api";
import { useBanners } from "@/lib/banner/BannerProvider";
import { MESSAGES } from "@/lib/messages";
import { useSession } from "@/lib/session";
import { AUDIENCE_OPTIONS, saveFailedText } from "./messages";
import { useAddNote } from "./queries";
import type { Note } from "./types";
import styles from "./NoteForm.module.css";

/** The longest note the contract accepts; the box stops there instead of failing on submit. */
const NOTE_MAX_LENGTH = CreateNoteRequest.shape.body.maxLength ?? undefined;

export interface NoteFormProps {
  readonly jobId: string;
}

/** The new-note form (§5.7): textarea, "For:" select (a label only) and ADD NOTE. */
export function NoteForm({ jobId }: NoteFormProps) {
  const add = useAddNote(jobId);
  const text = useRef<HTMLTextAreaElement>(null);
  const [body, setBody] = useState("");
  const [audience, setAudience] = useState<Note["audience"]>("all");
  const [error, setError] = useState<string | null>(null);

  // A note being written is kept when the session ends and comes back in the box after sign-in (§3.1, §15).
  const { user } = useSession();
  const banners = useBanners();
  const typed = useRef("");
  useDraft(
    draftKey(user.id, jobId, "note"),
    () => (typed.current.trim() ? { text: typed.current, base: "" } : null),
    (draft) => {
      if (!draft.text.trim()) return;
      typed.current = draft.text;
      setBody(draft.text);
      banners.show("draft-restored", MESSAGES.draftRestored);
    },
  );

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    // The contract decides what a note is (trimmed, not empty, not too long) and what is said when it is not.
    const parsed = CreateNoteRequest.safeParse({ body, audience });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "");
      text.current?.focus();
      return;
    }
    setError(null);
    add.mutate(parsed.data, {
      onSuccess: () => {
        typed.current = "";
        setBody("");
        text.current?.focus();
      },
      onError: (problem) => {
        setError(saveFailedText(problem instanceof ApiProblem ? problem.requestId : undefined));
      },
    });
  };

  return (
    <form className={styles.form} onSubmit={submit} noValidate>
      <Textarea
        ref={text}
        rows={3}
        maxLength={NOTE_MAX_LENGTH}
        aria-label="New job note"
        value={body}
        onChange={(event) => {
          typed.current = event.target.value;
          setBody(event.target.value);
        }}
      />
      <div className={styles.row}>
        <Select
          aria-label="Note is for"
          value={audience}
          className={styles.select}
          onChange={(event) => {
            setAudience(AUDIENCE_OPTIONS.find(([value]) => value === event.target.value)?.[0] ?? "all");
          }}
        >
          {AUDIENCE_OPTIONS.map(([value, label]) => (
            <option key={value} value={value}>
              For: {label}
            </option>
          ))}
        </Select>
        <Button type="submit" variant="primary" disabled={add.isPending} className={styles.add}>
          Add note
        </Button>
      </div>
      <div aria-live="polite">
        {error && (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        )}
      </div>
    </form>
  );
}
