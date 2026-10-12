import type { FileMeta } from "@kr/contracts";
import { apiPath, redirectToSignIn } from "@/lib/api/client";
import { VIEWER_MESSAGES } from "./messages";

/** Same-origin URL of a file's bytes through the BFF (ADR-0005). The browser sends the session cookie itself. */
export function contentUrl(fileId: string, disposition: "inline" | "attachment" = "inline"): string {
  const path = apiPath("getFileContent", { fileId });
  return disposition === "attachment" ? `${path}?disposition=attachment` : path;
}

/** What the viewer body shows for one file. */
export type ViewerView =
  | { readonly type: "unavailable"; readonly message: string }
  | { readonly type: "pdf" | "image" | "video" | "text" | "dwg" }
  /** Shown from the parsed message (`email.bodyText`), whatever the container: .eml, Outlook .msg or pasted text. */
  | { readonly type: "email" };

/** Outlook messages are stored as the original CFB file: their bytes are not text, so only the parsed body can be shown. */
export const OUTLOOK_MSG = "application/vnd.ms-outlook";

/** Choose the body: a scan state that blocks the file wins over its kind (§5.5, §11.1). */
export function viewFor(
  file: Pick<FileMeta, "kind" | "scanStatus" | "scanRetriesExhausted" | "contentType" | "email">,
): ViewerView {
  switch (file.scanStatus) {
    case "pending":
      return { type: "unavailable", message: VIEWER_MESSAGES.pending };
    case "infected":
      return { type: "unavailable", message: VIEWER_MESSAGES.infected };
    case "error":
      // While the worker still re-scans it, the file is "still being checked", not lost.
      return {
        type: "unavailable",
        message: file.scanRetriesExhausted ? VIEWER_MESSAGES.scanError : VIEWER_MESSAGES.pending,
      };
    case "clean":
    case "skipped":
      break;
  }
  if (file.kind === "email") return { type: "email" };
  // A pasted email is stored as a text file that carries its email metadata.
  if (file.kind === "text" && file.email) return { type: "email" };
  return { type: file.kind };
}

/** "Open in new tab" only where the server answers inline (PDF, image, video, text); the rest would download. */
export function opensInTab(view: ViewerView): boolean {
  return view.type === "pdf" || view.type === "image" || view.type === "video" || view.type === "text";
}

/**
 * Why a file's bytes did not load into an `<img>` or `<video>`, which only report "error": ask the same URL for its
 * first byte (a `Range` request, so a large video is not downloaded again) and read the HTTP status. 0 when the server
 * cannot be reached; 401 sends the person to sign-in, as every other file request does.
 */
export async function probeContentStatus(fileId: string, signal?: AbortSignal): Promise<number> {
  try {
    const response = await fetch(contentUrl(fileId), {
      credentials: "same-origin",
      headers: { range: "bytes=0-0" },
      signal: signal ?? null,
    });
    void response.body?.cancel();
    if (response.status === 401) redirectToSignIn();
    return response.status;
  } catch (error) {
    if (signal?.aborted) throw error;
    return 0;
  }
}
