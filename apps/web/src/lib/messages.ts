import { ApiProblem } from "@/lib/api/problem";

/** Exact user-facing texts shared across features (PRODUCT_SPEC §5.1). Australian English. */
export const MESSAGES = {
  /** 412 on an If-Match write: the latest version has been loaded. */
  stale: "Someone else changed this — the latest version has been loaded.",
  readOnly: "You have view-only access to this tracker, so changes can't be saved.",
  saveFailed: "A change couldn't be saved. Reload the page and try again.",
  /** Status 0 on a write: the same connectivity wording the tracker shows when it can't load (§5.1). */
  offline:
    "Can't reach the server – check your connection. What you see may be out of date, and changes can't be saved.",
  /** 429 on a write (rate limit, `Retry-After`; §14). */
  tooManyChanges: "Too many changes – wait a moment and try again.",
  /** After sign-in: what was typed when the session ended is back in its field (PRODUCT_SPEC 3.1, 15). */
  draftRestored: "What you were typing when your session ended has been restored.",
  draftRestoredChanged:
    "What you were typing when your session ended has been put back, but someone else changed this meanwhile. Check it, then click out of the box to save.",
  signOutFailed: "Sign-out didn't work – please try again.",
} as const;

/** The save-failure banner text, with the request id when there is one (EH-1). */
export function saveFailedText(requestId: string | undefined): string {
  return requestId ? `${MESSAGES.saveFailed} (Request ID: ${requestId})` : MESSAGES.saveFailed;
}

/**
 * The save-failure banner text for what actually went wrong: no connection (status 0), rate limited (429) or anything
 * else (reload text with the request id). Connectivity loss has no request id, by definition.
 */
export function saveFailedMessage(error: unknown): string {
  if (!(error instanceof ApiProblem)) return MESSAGES.saveFailed;
  if (error.status === 0) return MESSAGES.offline;
  const withId = (text: string) => (error.requestId ? `${text} (Request ID: ${error.requestId})` : text);
  return error.status === 429 ? withId(MESSAGES.tooManyChanges) : saveFailedText(error.requestId);
}
