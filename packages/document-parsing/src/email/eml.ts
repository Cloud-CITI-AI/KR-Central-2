/**
 * RFC 822 / MIME e-mail (.eml) -> ParsedEmail (PRODUCT_SPEC §10.3). Port of the prototype's parseEml / mimeSplit / mimeText:
 * RFC 2047 encoded words, multipart preference for text/plain, base64 and quoted-printable, charsets. Works on a latin1
 * view of the bytes so no byte is ever lost before the declared charset is applied.
 */
import { DocumentParseError } from "../errors.js";
import type { ParsedEmail } from "../types.js";
import { htmlToPlainText } from "./html.js";

/** Multipart nesting beyond this is ignored (a hostile message cannot recurse without bound). */
const MAX_DEPTH = 8;
/** A message must carry at least one of these headers to count as an e-mail at all. */
const EMAIL_HEADERS = ["from", "to", "subject", "date", "message-id", "mime-version", "content-type"];

interface Part {
  readonly headers: ReadonlyMap<string, string>;
  readonly body: string;
}

function splitPart(raw: string): Part {
  const i = raw.search(/\r?\n\r?\n/);
  const head = i < 0 ? raw : raw.slice(0, i);
  const body = i < 0 ? "" : raw.slice(i).replace(/^\r?\n\r?\n/, "");
  const headers = new Map<string, string>();
  for (const line of head.replace(/\r?\n[ \t]+/g, " ").split(/\r?\n/)) {
    const m = /^([\w-]+):\s*(.*)$/.exec(line);
    const name = m?.[1]?.toLowerCase();
    if (m && name && !headers.has(name)) headers.set(name, m[2] ?? "");
  }
  return { headers, body };
}

const latin1Bytes = (s: string): Uint8Array => Uint8Array.from(Buffer.from(s, "latin1"));

function decodeBytes(bytes: Uint8Array, charset: string | undefined): string {
  try {
    return new TextDecoder(charset ?? "utf-8").decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes); // unknown charset label
  }
}

/** quoted-printable (and the RFC 2047 "Q" form) to bytes; `q` also turns "_" into a space. */
function quotedPrintableBytes(text: string, q: boolean): Uint8Array {
  const joined = q ? text.replace(/_/g, " ") : text.replace(/=\r?\n/g, "");
  return latin1Bytes(joined.replace(/=([0-9A-F]{2})/gi, (_m, hex: string) => String.fromCharCode(parseInt(hex, 16))));
}

const base64Bytes = (text: string): Uint8Array => Uint8Array.from(Buffer.from(text.replace(/\s+/g, ""), "base64"));

const ENCODED_WORD = /=\?([^?\s]+)\?([BbQq])\?([^?\s]*)\?=/g;

/** RFC 2047 words; whitespace between adjacent words is dropped and consecutive words of one charset decode together. */
function decodeEncodedWords(value: string): string {
  let out = "";
  let last = 0;
  const run = { charset: "", chunks: [] as Uint8Array[] };
  const flush = (): void => {
    if (run.chunks.length > 0) out += decodeBytes(Buffer.concat(run.chunks), run.charset);
    run.chunks = [];
  };
  for (const m of value.matchAll(ENCODED_WORD)) {
    const gap = value.slice(last, m.index);
    if (run.chunks.length === 0 || gap.trim() !== "") {
      flush();
      out += gap;
    }
    const charset = (m[1] ?? "").replace(/\*.*$/, ""); // "utf-8*en" carries a language (RFC 2231)
    if (charset !== run.charset) flush();
    run.charset = charset;
    const text = m[3] ?? "";
    // chunks, never `push(...bytes)`: spreading a large word overflows the call stack
    const bytes = m[2]?.toLowerCase() === "b" ? base64Bytes(text) : quotedPrintableBytes(text, true);
    if (bytes.length > 0) run.chunks.push(bytes);
    last = m.index + m[0].length;
  }
  flush();
  return out + value.slice(last);
}

/** A header value: encoded words decoded; raw 8-bit text read as UTF-8 when it is valid UTF-8. */
function headerText(value: string | undefined): string {
  if (!value) return "";
  let text = value;
  if (/[\u0080-ÿ]/.test(text)) {
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(latin1Bytes(text));
    } catch {
      // not UTF-8: keep the latin1 reading
    }
  }
  return decodeEncodedWords(text).trim();
}

const boundaryOf = (contentType: string): string | undefined => /boundary="?([^";]+)"?/i.exec(contentType)?.[1];
const charsetOf = (contentType: string): string | undefined => /charset="?([^";]+)"?/i.exec(contentType)?.[1];

/** The best readable text of a part: text/plain first, then a nested multipart, then the first text part. */
function partText(part: Part, depth: number): string | null {
  const contentType = part.headers.get("content-type") ?? "text/plain";
  if (/^multipart\//i.test(contentType)) {
    const boundary = boundaryOf(contentType);
    if (!boundary || depth >= MAX_DEPTH) return null;
    const texts = part.body
      .split(`--${boundary}`)
      .slice(1)
      .filter((p) => !p.startsWith("--"))
      .map((p) => splitPart(p.replace(/^[ \t]*\r?\n/, "")))
      .map((p) => ({ type: p.headers.get("content-type") ?? "text/plain", text: partText(p, depth + 1) }))
      .filter((p): p is { type: string; text: string } => Boolean(p.text));
    return (
      (texts.find((p) => /text\/plain/i.test(p.type)) ?? texts.find((p) => /multipart/i.test(p.type)) ?? texts[0])
        ?.text ?? null
    );
  }
  if (!/^text\//i.test(contentType) || /attachment/i.test(part.headers.get("content-disposition") ?? "")) return null;
  const encoding = (part.headers.get("content-transfer-encoding") ?? "").toLowerCase();
  const bytes =
    encoding === "base64"
      ? base64Bytes(part.body)
      : encoding === "quoted-printable"
        ? quotedPrintableBytes(part.body, false)
        : latin1Bytes(part.body);
  const text = decodeBytes(bytes, charsetOf(contentType));
  return /html/i.test(contentType) ? htmlToPlainText(text) : text.trim();
}

/** Throws `DocumentParseError` (`invalid_eml`) when the input is empty or has no e-mail headers at all. */
export function parseEml(data: Uint8Array): ParsedEmail {
  const top = splitPart(Buffer.from(data).toString("latin1"));
  if (!EMAIL_HEADERS.some((name) => top.headers.has(name))) {
    throw new DocumentParseError("invalid_eml", "The file is not an e-mail message (.eml): no message headers.");
  }
  const sent = top.headers.has("date") ? new Date(top.headers.get("date") ?? "") : null;
  const header = (name: string): string => headerText(top.headers.get(name));
  return {
    subject: header("subject"),
    from: header("from"),
    to: header("to"),
    cc: header("cc"),
    date: sent && !Number.isNaN(sent.getTime()) ? sent.toISOString() : "",
    body: partText(top, 0) ?? "",
  };
}
