import type { FileKind } from "@kr/workflow";

/** Upload file-name hygiene (PRODUCT_SPEC §11): no path parts, no control characters, at most 255 characters. */
const MAX_LENGTH = 255;
/** Control (Cc), format (Cf: bidi overrides, zero-width), line and paragraph separators. */
const UNSAFE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu;
const FALLBACK = "file";

/** Extensions a stored text or email file may be served under (spec §11); pasted emails are stored as .txt. */
const SERVED_EXTENSIONS: Readonly<Partial<Record<FileKind, ReadonlySet<string>>>> = {
  text: new Set(["txt", "csv", "md"]),
  email: new Set(["eml", "msg", "txt"]),
};

/**
 * The name a stored file is downloaded and zipped under. Text and email content under any other extension (".vbe",
 * ".url", ".reg", ".exe" ... stored before uploads were restricted to .txt/.csv/.md) gets ".txt" appended, so the
 * download can never be something the recipient's machine runs. Other kinds are verified binary formats and keep their
 * name.
 */
export function servedFileName(name: string, kind: FileKind): string {
  const allowed = SERVED_EXTENSIONS[kind];
  if (allowed === undefined) return name;
  const extension = /\.([^./\\]+)$/.exec(name)?.[1]?.toLowerCase() ?? "";
  return allowed.has(extension) ? name : `${name}.txt`;
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
