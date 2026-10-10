"use client";
import { useEffect, useEffectEvent, useRef } from "react";
import { registerDraft, takeDraft, type DraftSnapshot, type StoredDraft } from "./drafts";

/**
 * Keep a field's unsaved text across the session ending (see drafts.ts). While the field is mounted `read` is asked for
 * what it holds when a request answers 401 (`null` when nothing is unsaved); when it mounts with a draft kept from before
 * sign-in, `onRestore` gets it once. With no `key` (a field that cannot be edited) nothing is kept or restored.
 */
export function useDraft(
  key: string | undefined,
  read: () => DraftSnapshot | null,
  onRestore: (draft: StoredDraft) => void,
): void {
  const reader = useRef(read);
  useEffect(() => {
    reader.current = read;
  });
  const restore = useEffectEvent(onRestore);
  useEffect(() => {
    if (!key) return;
    const draft = takeDraft(key);
    if (draft) restore(draft);
    return registerDraft(key, () => reader.current());
  }, [key]);
}
