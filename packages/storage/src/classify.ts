/**
 * Content sniffing for uploads (ADR-0011, PRODUCT_SPEC §11): decides what an upload really is from its first bytes.
 * The declared type and the file extension are never trusted; the name is only used where bytes cannot tell
 * (.msg vs other OLE files, .eml vs plain text, csv/md vs txt); text is accepted only under a .txt, .csv or .md name.
 */
import { fileTypeFromBuffer } from "file-type";
import type { FileKind } from "@kr/workflow";
import type { ContentClassification } from "./index.js";

/** Callers pass at least this many leading bytes (or the whole file when smaller). */
export const SNIFF_BYTES = 8192;

export interface ContentRejection {
  /** Human-readable reason, safe to show to the uploader. */
  readonly rejected: string;
}
export type ClassifyResult = ContentClassification | ContentRejection;

const accepted = (kind: FileKind, contentType: string, extension: string): ContentClassification => ({
  kind,
  contentType,
  extension,
});

const PNG = accepted("image", "image/png", "png");
/** file-type MIME type -> canonical classification. Anything else file-type recognises is rejected. */
const BINARY_KINDS: Readonly<Record<string, ContentClassification>> = {
  "application/pdf": accepted("pdf", "application/pdf", "pdf"),
  "image/png": PNG,
  "image/apng": PNG,
  "image/jpeg": accepted("image", "image/jpeg", "jpg"),
  "image/gif": accepted("image", "image/gif", "gif"),
  "image/webp": accepted("image", "image/webp", "webp"),
  "video/mp4": accepted("video", "video/mp4", "mp4"),
  "video/webm": accepted("video", "video/webm", "webm"),
};

const EXECUTABLES = new Set(["exe", "elf", "macho", "wasm", "dmg", "deb", "rpm", "msi", "apk", "class", "lnk"]);
const ARCHIVES = new Set(["zip", "rar", "7z", "gz", "tar", "bz2", "xz", "zst", "lz", "lzh", "cab", "arj", "z", "iso"]);
/** Text with one of these names is refused whatever it contains (defence in depth against script upload). */
const SCRIPT_EXTENSIONS = new Set(
  "html htm xhtml svg xml js mjs cjs jsx ts tsx php sh bash zsh bat cmd ps1 vbs hta py pl rb".split(" "),
);
const MAIL_HEADERS = new Set(
  "received return-path delivered-to from to cc bcc subject date message-id mime-version reply-to sender content-type".split(
    " ",
  ),
);

const TEXT_NAME_REJECTION = "Text files must be .txt, .csv or .md";

const reject = (rejected: string): ContentRejection => ({ rejected });
const extensionOf = (fileName: string): string => /\.([^./\\]+)$/.exec(fileName)?.[1]?.toLowerCase() ?? "";
const startsWith = (head: Uint8Array, magic: readonly number[]): boolean => magic.every((b, i) => head[i] === b);
const CFB_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const isDigit = (b: number | undefined): boolean => b !== undefined && b >= 0x30 && b <= 0x39;

/** DWG: ASCII `AC10dd` then binary data (a text file that merely starts with "AC1015" has no NUL byte). */
const isDwg = (head: Uint8Array): boolean =>
  startsWith(head, [0x41, 0x43, 0x31, 0x30]) && isDigit(head[4]) && isDigit(head[5]) && head.includes(0);

/** RFC 822 header block: continuation lines allowed, at least two well-known fields, every line a header. */
function looksLikeRfc822(text: string): boolean {
  const lines = text.split(/\r?\n/);
  let fields = 0;
  let known = 0;
  for (const [i, line] of lines.entries()) {
    if (line === "") break;
    if (/^[ \t]/.test(line)) {
      if (fields === 0) return false;
      continue;
    }
    const name = /^([\x21-\x39\x3b-\x7e]+):/.exec(line)?.[1];
    if (name === undefined) {
      if (i === lines.length - 1) break; // the head may cut the last line short
      return false;
    }
    fields++;
    if (MAIL_HEADERS.has(name.toLowerCase())) known++;
  }
  return fields >= 2 && known >= 2;
}

/** Strict UTF-8 decode of a head (a multi-byte character cut by the sniff limit is tolerated); undefined if invalid. */
function decodeUtf8(head: Uint8Array): string | undefined {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(head, { stream: head.length >= SNIFF_BYTES });
  } catch {
    return undefined;
  }
}

function classifyText(head: Uint8Array, fileName: string): ClassifyResult {
  const text = decodeUtf8(head);
  if (text === undefined) return reject("Not a recognised file type (binary data, not UTF-8 text)");
  if (head.includes(0)) return reject("Not a recognised file type (binary data)");
  const body = text.trimStart(); // the decoder already dropped any UTF-8 BOM
  if (/^<svg[\s>]|^<\?xml[^]*<svg[\s>]/i.test(body)) return reject("SVG images are not accepted");
  if (/^<[!?/a-z]/i.test(body)) return reject("HTML and XML documents are not accepted");
  const extension = extensionOf(fileName);
  if (body.startsWith("#!") || SCRIPT_EXTENSIONS.has(extension)) return reject("Scripts are not accepted");
  if (extension === "eml" && looksLikeRfc822(body)) return accepted("email", "message/rfc822", "eml");
  // Text is TXT, CSV or MD (spec §11): an allow-list, because a deny-list of script names is never complete
  // (.vbe, .url, .reg, .psm1, .exe ... are all UTF-8 text that something on the recipient's machine will run).
  if (extension === "csv") return accepted("text", "text/csv", "csv");
  if (extension === "md") return accepted("text", "text/markdown", "md");
  if (extension === "txt") return accepted("text", "text/plain", "txt");
  return reject(TEXT_NAME_REJECTION);
}

/**
 * Classifies an upload from its leading bytes (see {@link SNIFF_BYTES}) and its name. Fails closed: anything not
 * explicitly accepted is rejected with a reason.
 */
export async function classifyContent(head: Uint8Array, fileName: string): Promise<ClassifyResult> {
  if (head.length === 0) return reject("The file is empty");
  if (startsWith(head, CFB_MAGIC)) {
    return extensionOf(fileName) === "msg"
      ? accepted("email", "application/vnd.ms-outlook", "msg") // the worker confirms by parsing it
      : reject("Only Outlook .msg files are accepted from the OLE document family");
  }
  if (isDwg(head)) return accepted("dwg", "image/vnd.dwg", "dwg");
  const detected = await fileTypeFromBuffer(head);
  // file-type also reports "dwg" for any text starting "AC10"; our stricter check above already decided that.
  if (detected === undefined || detected.ext === "dwg") return classifyText(head, fileName);
  const known = BINARY_KINDS[detected.mime];
  if (known !== undefined) return known;
  // file-type matches short magics ("BM", "MZ", "ID3", "BEGIN:VCALENDAR", "{\\rtf1", "%!PS") that valid text can start
  // with. Real BMP, PE, MP3 etc. headers contain NUL bytes or invalid UTF-8, so UTF-8 without NUL is text (spec §11);
  // classifyText still rejects HTML, SVG, XML and scripts.
  if (!head.includes(0) && decodeUtf8(head) !== undefined) return classifyText(head, fileName);
  if (detected.ext === "xml") return reject("HTML and XML documents are not accepted");
  if (EXECUTABLES.has(detected.ext)) return reject(`Executable files are not accepted (${detected.ext})`);
  if (ARCHIVES.has(detected.ext)) return reject(`Archive files are not accepted (${detected.ext})`);
  return reject(`File type not accepted (${detected.ext})`);
}

/** True when the sniffed content is one of the kinds the slot accepts; a rejection never is. */
export function isAcceptedForSlot(result: ClassifyResult, accept: readonly FileKind[]): boolean {
  return !("rejected" in result) && accept.includes(result.kind);
}
