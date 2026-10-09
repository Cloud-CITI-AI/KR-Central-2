"use client";
import { useEffect, useRef, useState, type ChangeEvent } from "react";

export interface UseAutosaveTextOptions {
  /** The saved text (from the job). */
  readonly value: string;
  /**
   * Save `text`. Called only when it differs from `value`. Return the write's promise (settled either way) so the field
   * keeps what was typed until the write is over, then shows `value` again: the saved text, or the old one after a rollback.
   */
  readonly onSave: (text: string) => Promise<unknown>;
  /** Quiet time after typing before it saves (§5.5: 700 ms). */
  readonly delayMs?: number;
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
 * it had worked.
 */
export function useAutosaveText({ value, onSave, delayMs = 700 }: UseAutosaveTextOptions): UseAutosaveText {
  const [text, setText] = useState(value);
  const [editing, setEditing] = useState(false);
  const [writes, setWrites] = useState(0);
  const typed = useRef(value);
  const saved = useRef(value);
  const save = useRef(onSave);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    saved.current = value;
    save.current = onSave;
  });

  const flush = (next: string) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (next === saved.current) return;
    const write = save.current(next);
    setWrites((n) => n + 1);
    void write.finally(() => {
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

  const shown = editing || writes > 0 ? text : value;
  return {
    text: shown,
    onChange: (event) => {
      const next = event.target.value;
      typed.current = next;
      setText(next);
      setEditing(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        flush(typed.current);
      }, delayMs);
    },
    onFocus: () => {
      typed.current = shown;
      setText(shown);
      setEditing(true);
    },
    onBlur: () => {
      const next = typed.current.trim();
      typed.current = next;
      setText(next);
      setEditing(false);
      flush(next);
    },
  };
}
