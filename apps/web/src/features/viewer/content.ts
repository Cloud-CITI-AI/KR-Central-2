import type { FileMeta } from "@kr/contracts";
import { apiPath } from "@/lib/api/client";
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
export function viewFor(file: Pick<FileMeta, "kind" | "scanStatus" | "contentType" | "email">): ViewerView {
  switch (file.scanStatus) {
    case "pending":
      return { type: "unavailable", message: VIEWER_MESSAGES.pending };
    case "infected":
      return { type: "unavailable", message: VIEWER_MESSAGES.infected };
    case "error":
      return { type: "unavailable", message: VIEWER_MESSAGES.scanError };
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
