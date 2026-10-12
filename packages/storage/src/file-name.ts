import type { FileKind } from "@kr/workflow";

/** Upload file-name hygiene (PRODUCT_SPEC §11): no path parts, no control characters, at most 255 characters. */
const MAX_LENGTH = 255;
/** Control (Cc), format (Cf: bidi overrides, zero-width), line and paragraph separators. */
const UNSAFE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu;
const FALLBACK = "file";

/** What each kind may be served under, and the extension appended when the name's own is not one of them (spec §11). */
interface ServedRule {
  readonly allowed: ReadonlySet<string>;
  /** The sniffed content type -> canonical extension, for kinds with more than one format. */
  readonly byContentType?: Readonly<Record<string, string>>;
  readonly fallback: string;
}

const SERVED_RULES: Readonly<Record<FileKind, ServedRule>> = {
  // Pasted emails are stored as .txt.
  text: { allowed: new Set(["txt", "csv", "md"]), fallback: "txt" },
  email: { allowed: new Set(["eml", "msg", "txt"]), fallback: "txt" },
  pdf: { allowed: new Set(["pdf"]), fallback: "pdf" },
  dwg: { allowed: new Set(["dwg"]), fallback: "dwg" },
  image: {
    allowed: new Set(["png", "jpg", "jpeg", "gif", "webp", "heic"]),
    byContentType: { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" },
    fallback: "png",
  },
  video: {
    allowed: new Set(["mp4", "mov", "m4v", "webm"]),
    byContentType: { "video/mp4": "mp4", "video/webm": "webm" },
    fallback: "mp4",
  },
};

/**
 * The name a stored file is downloaded and zipped under (the stored display name is not changed). Content under an
 * extension that is not one of its kind's own (".exe", ".lnk", ".vbe", ".url", no extension ...) gets the kind's canonical
 * extension appended, so the download can never be something the recipient's machine runs: a PDF uploaded as
 * "report.exe" is served as "report.exe.pdf", a text file stored before uploads were restricted as "evil.vbe.txt".
 * The kind is what the bytes were sniffed to be at upload; `contentType` (the sniffed type) picks the extension for
 * kinds with several formats (images, video) and defaults to png / mp4 when it is unknown.
 */
export function servedFileName(name: string, kind: FileKind, contentType?: string): string {
  const rule = SERVED_RULES[kind];
  const extension = /\.([^./\\]+)$/.exec(name)?.[1]?.toLowerCase() ?? "";
  if (rule.allowed.has(extension)) return name;
  return `${name}.${(contentType !== undefined ? rule.byContentType?.[contentType.toLowerCase()] : undefined) ?? rule.fallback}`;
}

/**
 * Browsers escape `"`, CR and LF in a multipart file name as %22, %0D and %0A (HTML multipart/form-data rules) and
 * nothing else, so those three are put back before sanitising: the person sees the name they chose (control characters
 * are then dropped by {@link sanitiseFileName}). Other percent sequences are literal text and stay as they are.
 */
export function decodeMultipartFileName(name: string): string {
  return name.replace(/%(22|0D|0A)/gi, (_match, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)));
}

/**
 * Returns a display-safe name: the last path segment only, without control or bidi characters or trailing dots and
 * spaces, at most 255 UTF-16 units long and keeping the extension. Never empty. The name is for display and download
 * headers only; storage keys never contain it.
 */
export function sanitiseFileName(name: string): string {
  const segment =
    name
      .toWellFormed()
      .normalize("NFC")
      .split(/[\\/]+/)
      .filter(Boolean)
      .pop() ?? "";
  const clean = segment
    .replace(UNSAFE, "")
    .trim()
    .replace(/[. ]+$/, "");
  if (clean.length <= MAX_LENGTH) return clean || FALLBACK;
  const extension = /\.[^.\s]{1,32}$/.exec(clean)?.[0] ?? "";
  let stem = clean.slice(0, clean.length - extension.length).slice(0, MAX_LENGTH - extension.length);
  if (/[\uD800-\uDBFF]$/.test(stem)) stem = stem.slice(0, -1); // never split a surrogate pair
  return stem.replace(/[. ]+$/, "") + extension;
}
