/**
 * What a file download says about itself (PRODUCT_SPEC §11, §5.5, §11.1; ADR-0011): the scan gate, the headers that
 * keep stored content from running in the browser, and HTTP Range. Pure.
 */
import { PROBLEM_TYPES } from "@kr/contracts";
import type { FileRow } from "@kr/db";
import { servedFileName } from "@kr/storage";
import type { FileKind } from "@kr/workflow";
import { AppError, ConflictError } from "../../../platform/errors.js";

/** CSP for everything but a PDF: nothing runs, nothing loads, and the document is sandboxed (PRODUCT_SPEC §11). */
export const SANDBOX_CSP = "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox";

/** Kinds a browser may show in place; everything else is always a download. */
const INLINE_KINDS: ReadonlySet<FileKind> = new Set(["pdf", "image", "video", "text"]);

/** The user-facing reasons a file cannot be opened (PRODUCT_SPEC §5.5, §11.1). */
export const SCAN_MESSAGES = {
  pending: "This file is still being checked for viruses.",
  infected: "Blocked – failed the virus scan",
  error: "Couldn't be checked for viruses – remove it and upload it again",
} as const;

/** Content is served only when the scan came back clean, or was switched off for local development. */
export function assertServable(scanStatus: FileRow["scan_status"]): void {
  if (scanStatus === "clean" || scanStatus === "skipped") return;
  if (scanStatus === "pending") {
    throw new ConflictError({ type: PROBLEM_TYPES.fileNotReady, detail: SCAN_MESSAGES.pending });
  }
  throw new ConflictError({ type: PROBLEM_TYPES.fileRejected, detail: SCAN_MESSAGES[scanStatus] });
}

/** RFC 5987 `value-chars`: percent-encode everything but attr-char. */
function encodeRfc5987(value: string): string {
  return encodeURIComponent(value).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/** `inline; filename="plan.pdf"; filename*=UTF-8''plan.pdf`: an ASCII fallback plus the real name (RFC 6266). */
export function contentDispositionFor(disposition: "inline" | "attachment", name: string): string {
  const fallback = name.replace(/[^\x20-\x7e]|["\\%]/g, "_");
  return `${disposition}; filename="${fallback}"; filename*=UTF-8''${encodeRfc5987(name)}`;
}

export interface ContentHeaders {
  readonly contentType: string;
  readonly contentDisposition: string;
  /** null for a PDF (the browser's viewer needs more than the sandbox allows); the sandbox CSP otherwise. */
  readonly contentSecurityPolicy: string | null;
}

/**
 * `inline` only for PDF, images, video and text, and only when asked; text is always `text/plain; charset=utf-8`
 * (CSV and Markdown included). The stored content type is the sniffed one, never the uploader's.
 */
export function contentHeadersFor(
  file: Pick<FileRow, "kind" | "content_type" | "original_name">,
  requested: "inline" | "attachment",
): ContentHeaders {
  const disposition = requested === "inline" && INLINE_KINDS.has(file.kind) ? "inline" : "attachment";
  return {
    contentType: file.kind === "text" ? "text/plain; charset=utf-8" : file.content_type,
    contentDisposition: contentDispositionFor(disposition, servedFileName(file.original_name, file.kind)),
    contentSecurityPolicy: file.kind === "pdf" ? null : SANDBOX_CSP,
  };
}

/** 416 (RFC 9110 §15.5.17): the requested range starts after the end of the file. */
export class RangeNotSatisfiableError extends AppError {
  constructor(size: number) {
    super(416, PROBLEM_TYPES.internal, "Range not satisfiable", {
      detail: `The file has ${size} bytes.`,
      headers: { "content-range": `bytes */${size}` },
    });
  }
}

export interface ByteRange {
  /** Inclusive byte offsets. */
  readonly start: number;
  readonly end: number;
}

/**
 * The single byte range a `Range` header asks for, clamped to the file; null when the whole file is to be sent.
 * Only `bytes` and one range are supported; anything else (several ranges, other units, a malformed value) is ignored,
 * which RFC 9110 §14.2 allows. A range that starts past the end is a 416.
 */
export function parseRange(header: string | undefined, size: number): ByteRange | null {
  const m = header === undefined ? null : /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === "" && m[2] === "")) return null;
  const [first, last] = [m[1] ?? "", m[2] ?? ""];
  if (first === "") {
    // "-N": the last N bytes.
    const count = Number(last);
    if (!Number.isSafeInteger(count) || count === 0 || size === 0) throw new RangeNotSatisfiableError(size);
    return { start: Math.max(0, size - count), end: size - 1 };
  }
  const start = Number(first);
  const end = last === "" ? size - 1 : Math.min(Number(last), size - 1);
  if (!Number.isSafeInteger(start) || start >= size || end < start) {
    // "5-3" is syntactically invalid (ignored); a start past the end is unsatisfiable.
    if (last !== "" && Number(last) < start) return null;
    throw new RangeNotSatisfiableError(size);
  }
  return { start, end };
}
