import type { FileMeta } from "@kr/contracts";
import { formatMegabytes } from "@/lib/format";

export interface FileRejection {
  readonly file: File;
  /** User-facing text, exactly as PRODUCT_SPEC §5.5 words it. */
  readonly message: string;
}

export interface FileRules {
  /** File picker style tokens: ".pdf", "image/*", "application/pdf". Omitted = anything. */
  readonly accept?: readonly string[] | undefined;
  /** Used in the type message: "PDF or photo". */
  readonly acceptDescription?: string | undefined;
  readonly maxBytes?: number | undefined;
  readonly multiple?: boolean | undefined;
}

export function matchesAccept(file: Pick<File, "name" | "type">, accept: readonly string[]): boolean {
  const name = file.name.toLowerCase();
  const type = file.type.toLowerCase();
  return accept.some((token) => {
    const t = token.trim().toLowerCase();
    if (t.startsWith(".")) return name.endsWith(t);
    if (t.endsWith("/*")) return type.startsWith(t.slice(0, -1));
    return type === t;
  });
}

/** Upper-case extension for the document row badge: "Decision Letter.pdf" → "PDF". */
export function fileExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 && dot < name.length - 1 ? name.slice(dot + 1, dot + 5).toUpperCase() : "FILE";
}

/**
 * Client-side pre-check of dropped or chosen files (the server enforces type by content sniffing and size again, §11).
 * Messages are the §5.5 texts: "<name> is larger than 50 MB" and "<name> isn't a supported type for this box (use …)".
 */
export function validateFiles(
  files: readonly File[],
  rules: FileRules,
): { accepted: File[]; rejected: FileRejection[] } {
  const accepted: File[] = [];
  const rejected: FileRejection[] = [];
  for (const file of files) {
    if (rules.multiple === false && accepted.length > 0) {
      rejected.push({ file, message: `${file.name} wasn't added – this box takes one file at a time` });
    } else if (rules.maxBytes !== undefined && file.size > rules.maxBytes) {
      rejected.push({ file, message: `${file.name} is larger than ${formatMegabytes(rules.maxBytes)} MB` });
    } else if (rules.accept && !matchesAccept(file, rules.accept)) {
      const use = rules.acceptDescription ? ` (use ${rules.acceptDescription})` : "";
      rejected.push({ file, message: `${file.name} isn't a supported type for this box${use}` });
    } else {
      accepted.push(file);
    }
  }
  return { accepted, rejected };
}

/** The scan states of a file row, exactly as PRODUCT_SPEC §5.5 words them (infected and error files cannot be opened). */
export const SCAN_TEXT = {
  pending: "Scanning…",
  infected: "Blocked – failed the virus scan",
  /** Only once the worker's automatic re-scans are used up (`scanRetriesExhausted`). */
  error: "Couldn't be checked for viruses – remove it and upload it again",
  /** A failed scan the hourly sweep will still retry: the file is not lost, so do not ask for a re-upload (§11, §5.5). */
  retrying: "Still being checked for viruses…",
} as const;

/** The row text for a file's scan state, or undefined when there is none to show (clean, skipped). */
export function scanStateText(file: Pick<FileMeta, "scanStatus" | "scanRetriesExhausted">): string | undefined {
  switch (file.scanStatus) {
    case "pending":
      return SCAN_TEXT.pending;
    case "infected":
      return SCAN_TEXT.infected;
    case "error":
      return file.scanRetriesExhausted ? SCAN_TEXT.error : SCAN_TEXT.retrying;
    case "clean":
    case "skipped":
      return undefined;
  }
}
