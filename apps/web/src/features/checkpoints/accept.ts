import type { SlotDefinition, FileKind } from "@kr/workflow";
import type { FileRules } from "@/lib/files";

/** File picker tokens of each kind the API accepts (it sniffs the content again and answers 415 on a mismatch). */
const EXTENSIONS: Readonly<Record<FileKind, readonly string[]>> = {
  pdf: [".pdf"],
  image: [".png", ".jpg", ".jpeg", ".gif", ".webp"],
  video: [".mp4", ".webm"],
  text: [".txt", ".csv", ".md"],
  dwg: [".dwg"],
  email: [".msg", ".eml"],
};

const KIND_LABELS: Readonly<Record<FileKind, string>> = {
  pdf: "PDF",
  image: "photo",
  video: "video",
  text: "text",
  dwg: "DWG",
  email: "Outlook .msg or .eml email",
};

/** "PDF or photo", "PDF, photo, video or text": the wording of the API's own 415 message. */
export function describeAccept(accept: readonly FileKind[]): string {
  const labels = accept.map((kind) => KIND_LABELS[kind]);
  return labels.length <= 1 ? (labels[0] ?? "") : `${labels.slice(0, -1).join(", ")} or ${labels.at(-1) ?? ""}`;
}

/** What a drop zone checks before sending a file: the slot's kinds and the global size limit (§5.5, §11). */
export function slotFileRules(slot: Pick<SlotDefinition, "accept">, maxBytes: number): FileRules {
  return {
    accept: slot.accept.flatMap((kind) => EXTENSIONS[kind]),
    acceptDescription: describeAccept(slot.accept),
    maxBytes,
  };
}
