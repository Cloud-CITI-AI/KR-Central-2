/**
 * Unsaved text that survives the session ending (PRODUCT_SPEC 3.1 "go to sign-in and come back here", 15 "comment content
 * is never replaced or lost"). A field that holds text the server may not have yet registers a reader here; when any
 * request answers 401 the client calls `persistDrafts()` before it navigates to sign-in, and the field takes its draft
 * back (`takeDraft`) when it mounts again after `returnTo`.
 *
 * Drafts live in `sessionStorage` (this tab only, gone when it closes), keyed by user, so another person signing in on the
 * same tab never sees them, and are dropped after two hours. Every storage access is guarded: it can throw (blocked site
 * data, private windows, full quota) and then the person is still sent to sign-in, as before.
 */

const PREFIX = "kr-draft:";
const MAX_AGE_MS = 2 * 60 * 60 * 1000;

/** What a field holds: the text, and the saved text it was typed over (to notice that someone else changed it since). */
export interface DraftSnapshot {
  readonly text: string;
  readonly base: string;
}

export interface StoredDraft extends DraftSnapshot {
  readonly savedAt: number;
}

/** `null` when the field has nothing unsaved to keep (not focused, no pending or running save). */
type DraftReader = () => DraftSnapshot | null;

const readers = new Map<string, DraftReader>();

/** `kr-draft:<user>:<part>:<part>…`, e.g. `draftKey(userId, jobId, "i8_3", "krNote")`. */
export function draftKey(userId: string, ...parts: readonly string[]): string {
  return `${PREFIX}${userId}:${parts.join(":")}`;
}

/** Register a field's reader; call the returned function when the field goes away. */
export function registerDraft(key: string, read: DraftReader): () => void {
  readers.set(key, read);
  return () => {
    if (readers.get(key) === read) readers.delete(key);
  };
}

function storage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null; // blocked site data or a private window: no drafts, the sign-in redirect goes ahead
  }
}

const isStoredDraft = (value: unknown): value is StoredDraft =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as Record<string, unknown>).text === "string" &&
  typeof (value as Record<string, unknown>).base === "string" &&
  typeof (value as Record<string, unknown>).savedAt === "number";

/** Drop drafts nobody came back for. */
function sweep(store: Storage, now: number): void {
  const stale: string[] = [];
  for (let i = 0; i < store.length; i += 1) {
    const key = store.key(i);
    if (!key?.startsWith(PREFIX)) continue;
    let draft: unknown;
    try {
      draft = JSON.parse(store.getItem(key) ?? "null");
    } catch {
      draft = null; // not ours any more: removed below
    }
    if (!isStoredDraft(draft) || now - draft.savedAt > MAX_AGE_MS) stale.push(key);
  }
  for (const key of stale) store.removeItem(key);
}

/** Write every active field's text to storage. Called by the API client just before it navigates to sign-in on a 401. */
export function persistDrafts(now: number = Date.now()): void {
  const store = storage();
  if (!store) return;
  try {
    sweep(store, now);
    for (const [key, read] of readers) {
      const snapshot = read();
      if (snapshot) store.setItem(key, JSON.stringify({ ...snapshot, savedAt: now } satisfies StoredDraft));
    }
  } catch {
    // Quota or blocked storage: keep what was written, never stop the redirect.
  }
}

/** The draft kept for `key` (once: it is removed), or null when there is none, it is too old or it is not a draft. */
export function takeDraft(key: string, now: number = Date.now()): StoredDraft | null {
  const store = storage();
  if (!store) return null;
  try {
    const raw = store.getItem(key);
    store.removeItem(key);
    const draft: unknown = raw === null ? null : JSON.parse(raw);
    return isStoredDraft(draft) && now - draft.savedAt <= MAX_AGE_MS ? draft : null;
  } catch {
    return null; // not JSON or storage refused: nothing to restore
  }
}

/** Is a draft kept for `key` (not too old)? Looks without taking it: for a parent that must open a form before it can restore. */
export function hasDraft(key: string, now: number = Date.now()): boolean {
  const store = storage();
  if (!store) return false;
  try {
    const raw = store.getItem(key);
    const draft: unknown = raw === null ? null : JSON.parse(raw);
    return isStoredDraft(draft) && now - draft.savedAt <= MAX_AGE_MS;
  } catch {
    return false;
  }
}

/** A form's text fields as one draft: they have no saved text to be typed over, so `base` stays empty. */
export function encodeFields<T extends { readonly [K in keyof T]: string }>(fields: T): DraftSnapshot {
  return { text: JSON.stringify(fields), base: "" };
}

/** The fields `names` of a form as typed (a control that is not text reads as empty). */
export function formFields<N extends string>(form: HTMLFormElement, names: readonly N[]): Record<N, string> {
  const data = new FormData(form);
  return Object.fromEntries(
    names.map((name) => {
      const value = data.get(name);
      return [name, typeof value === "string" ? value : ""];
    }),
  ) as Record<N, string>;
}

/** The fields `names` that `encodeFields` kept (missing ones empty), or null when the draft is not a record of text fields. */
export function decodeFields<N extends string>(draft: StoredDraft, names: readonly N[]): Record<N, string> | null {
  try {
    const value: unknown = JSON.parse(draft.text);
    if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
    const kept = new Map(Object.entries(value));
    if ([...kept.values()].some((field) => typeof field !== "string")) return null;
    return Object.fromEntries(names.map((name) => [name, kept.get(name) ?? ""])) as Record<N, string>;
  } catch {
    return null;
  }
}
