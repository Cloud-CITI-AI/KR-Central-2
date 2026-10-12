"use client";
import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { useDraft } from "@/lib/api";
import { useBanners } from "@/lib/banner/BannerProvider";
import { MESSAGES } from "@/lib/messages";

export interface UseAutosaveTextOptions {
  /** The saved text (from the job). */
  readonly value: string;
  /**
   * Save `text`. Called only when it differs from `value`. Return the write's promise (settled either way) so the field
   * keeps what was typed until the write is over, then shows `value` again: the saved text, or the old one after a rollback.
   */
  readonly onSave: (text: string, baseVersion?: number) => Promise<unknown>;
  /**
   * The version of the thing `value` belongs to (condition, checkpoint). With it the save is sent against the version the
   * text was typed over, not the one a background refresh brought in meanwhile: someone else's change to this same text
   * then answers 412 instead of being overwritten without a word (§14, §15), while a change to another field still merges.
   */
  readonly version?: number;
  /** Quiet time after typing before it saves (§5.5: 700 ms). */
  readonly delayMs?: number;
  /**
   * Keeps what is typed across the session ending (`draftKey(...)` from lib/api; omit when the field cannot be edited):
   * a 401 stores the unsaved text, and when the field mounts again after sign-in it gets that text back (§3.1, §15).
   */
  readonly draftKey?: string;
}

export interface UseAutosaveText {
  readonly text: string;
  readonly onChange: (event: ChangeEvent<HTMLTextAreaElement>) => void;
  readonly onFocus: () => void;
  readonly onBlur: () => void;
}

/**
 * A textarea that saves itself: 700 ms after typing stops, on blur (trimmed) and when it goes away with typing pending.
 * While the person is in the field (or their last save is still running) a refresh of the job never replaces what they typed
 * (§15); after that the field shows the job's text, so a save that was refused (rolled back) does not stay on screen as if
 * it had worked. With a `draftKey`, text the person typed that the server may not have is also kept when the session ends
 * and restored into the field after sign-in: saved at once when the saved text is still the one it was typed over, otherwise
 * left in the field for the person to check, because someone else changed it meanwhile.
 */
export function useAutosaveText({
  value,
  version,
  onSave,
  delayMs = 700,
  draftKey,
}: UseAutosaveTextOptions): UseAutosaveText {
  const banners = useBanners();
  const [text, setText] = useState(value);
  const [editing, setEditing] = useState(false);
  const [writes, setWrites] = useState(0);
  const typed = useRef(value);
  const saved = useRef(value);
  const save = useRef(onSave);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // What the draft needs when a request answers 401: is anything unsaved, and which saved text was typed over.
  const inField = useRef(false);
  const running = useRef(0);
  const confirmed = useRef(value);
  const confirmedVersion = useRef(version);
  const lastSent = useRef<string | null>(null);

  useEffect(() => {
    saved.current = value;
    save.current = onSave;
    // An optimistic update changes `value` while a write runs, and so can someone else's change while the person types: the
    // text a draft was typed over is the last one seen in an idle field, or the one the person's own last save made.
    if (running.current === 0 && (!inField.current || value === lastSent.current)) {
      confirmed.current = value;
      confirmedVersion.current = version;
    }
  });

  const flush = (next: string) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (next === saved.current) return;
    // Writes of this field run one after the other, each from the version the one before made: only a first write goes
    // against the version the text was typed over.
    const write = save.current(next, running.current === 0 ? confirmedVersion.current : undefined);
    lastSent.current = next;
    running.current += 1;
    setWrites((n) => n + 1);
    void write.finally(() => {
      running.current -= 1;
      setWrites((n) => n - 1);
    });
  };
  // Typing still pending when the field goes away is saved, not lost.
  useEffect(
    () => () => {
      if (timer.current) flush(typed.current);
    },
    [],
  );

  // Unsaved text is kept when the session ends and comes back as the field mounts after sign-in (lib/api/drafts.ts).
  useDraft(
    draftKey,
    () =>
      inField.current || running.current > 0 || timer.current !== null
        ? { text: typed.current, base: confirmed.current }
        : null,
    (draft) => {
      if (draft.text === saved.current) return;
      typed.current = draft.text;
      setText(draft.text);
      if (draft.base === saved.current) {
        banners.show("draft-restored", MESSAGES.draftRestored);
        flush(draft.text);
      } else {
        inField.current = true;
        setEditing(true);
        banners.show("draft-restored", MESSAGES.draftRestoredChanged);
      }
    },
  );

  const shown = editing || writes > 0 ? text : value;
  return {
    text: shown,
    onChange: (event) => {
      const next = event.target.value;
      typed.current = next;
      setText(next);
      inField.current = true;
      setEditing(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        flush(typed.current);
      }, delayMs);
    },
    onFocus: () => {
      typed.current = shown;
      setText(shown);
      inField.current = true;
      setEditing(true);
    },
    onBlur: () => {
      const next = typed.current.trim();
      typed.current = next;
      setText(next);
      inField.current = false;
      setEditing(false);
      flush(next);
    },
  };
}
