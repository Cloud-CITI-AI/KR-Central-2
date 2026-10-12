/** Exact viewer texts (PRODUCT_SPEC §5.5, §11.1). Australian English. */
export const VIEWER_MESSAGES = {
  pending: "This file is still being checked for viruses.",
  infected: "Blocked – failed the virus scan",
  scanError: "Couldn't be checked for viruses – remove it and upload it again",
  dwgTitle: "DWG drawings can't be previewed in the browser",
  dwgHint: "Download it and open it in your CAD software.",
  loading: "Loading…",
  loadFailed: "Couldn’t load this file. Use “Open in new tab”.",
  /** The file store is down (503, `storage-unavailable`): opening it in a new tab would fail the same way. */
  unavailable: "This file can't be loaded right now – try again shortly",
  pdfFailed: "Couldn’t load this PDF. Use “Open in new tab”.",
  emailBody: "The message text can't be previewed in the browser. Download the original to read it.",
  noMessageText: "(no message text)",
  openInNewTab: "Open in new tab",
  downloadOriginal: "Download original",
} as const;

/** The file store answered 503 (an `ApiProblem`, or pdf.js's `ResponseException`: both carry the HTTP status). */
export function isStorageUnavailable(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { readonly status?: unknown }).status === 503;
}

/** What the viewer says when a file's bytes did not load: the store being down is not "use Open in new tab". */
export function loadFailedText(error: unknown, otherwise: string): string {
  return isStorageUnavailable(error) ? VIEWER_MESSAGES.unavailable : otherwise;
}
