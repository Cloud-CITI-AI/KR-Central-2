/** Upload file-name hygiene (PRODUCT_SPEC §11): no path parts, no control characters, at most 255 characters. */
const MAX_LENGTH = 255;
/** Control (Cc), format (Cf: bidi overrides, zero-width), line and paragraph separators. */
const UNSAFE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu;
const FALLBACK = "file";

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
