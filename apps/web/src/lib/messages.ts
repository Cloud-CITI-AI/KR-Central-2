/** Exact user-facing texts shared across features (PRODUCT_SPEC §5.1). Australian English. */
export const MESSAGES = {
  /** 412 on an If-Match write: the latest version has been loaded. */
  stale: "Someone else changed this — the latest version has been loaded.",
  readOnly: "You have view-only access to this tracker, so changes can't be saved.",
  saveFailed: "A change couldn't be saved. Reload the page and try again.",
  signOutFailed: "Sign-out didn't work – please try again.",
} as const;

/** The save-failure banner text, with the request id when there is one (EH-1). */
export function saveFailedText(requestId: string | undefined): string {
  return requestId ? `${MESSAGES.saveFailed} (Request ID: ${requestId})` : MESSAGES.saveFailed;
}
