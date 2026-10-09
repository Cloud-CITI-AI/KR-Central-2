/**
 * Outlook .msg (Compound File Binary) -> ParsedEmail (PRODUCT_SPEC §10.3). Port of the prototype's parseMsg on `cfb`:
 * subject, sender name/email, To, Cc, submit/delivery time, plain body or HTML body as text.
 */
import * as CFB from "cfb";
import { DocumentParseError } from "../errors.js";
import type { ParsedEmail } from "../types.js";
import { htmlToPlainText } from "./html.js";

const FILETIME_EPOCH_MS = 11_644_473_600_000;
const PT_SYSTIME = 0x40;
const PR_CLIENT_SUBMIT_TIME = 0x0039;
const PR_MESSAGE_DELIVERY_TIME = 0x0e06;

function topLevelStreams(data: Uint8Array): Map<string, Uint8Array> {
  let container: CFB.CFB$Container;
  try {
    container = CFB.read(data, { type: "buffer" });
  } catch (error) {
    throw new DocumentParseError("invalid_msg", "The file is not an Outlook message (.msg).", { cause: error });
  }
  const streams = new Map<string, Uint8Array>();
  container.FileIndex.forEach((entry, i) => {
    const path = container.FullPaths[i] ?? "";
    // streams directly under the root storage; attachments and recipients live in sub-storages
    const content = entry.content as ArrayLike<number> | undefined;
    if (entry.type === 2 && path.split("/").length === 2 && content) {
      streams.set(entry.name.toUpperCase(), Uint8Array.from(content));
    }
  });
  if (![...streams.keys()].some((name) => name.startsWith("__SUBSTG1.0_"))) {
    throw new DocumentParseError("invalid_msg", "The file has no Outlook message properties.");
  }
  return streams;
}

/** The message time: PR_CLIENT_SUBMIT_TIME, else PR_MESSAGE_DELIVERY_TIME, as an ISO instant ("" when absent). */
function messageTime(properties: Uint8Array | undefined): string {
  if (!properties) return "";
  const view = new DataView(properties.buffer, properties.byteOffset, properties.byteLength);
  let iso = "";
  for (let o = 32; o + 16 <= properties.length; o += 16) {
    const tag = view.getUint32(o, true);
    const id = tag >>> 16;
    if ((tag & 0xffff) !== PT_SYSTIME || (id !== PR_CLIENT_SUBMIT_TIME && id !== PR_MESSAGE_DELIVERY_TIME)) continue;
    const ms = (view.getUint32(o + 12, true) * 4_294_967_296 + view.getUint32(o + 8, true)) / 1e4 - FILETIME_EPOCH_MS;
    if (ms <= 0) continue;
    iso = new Date(ms).toISOString();
    if (id === PR_CLIENT_SUBMIT_TIME) break;
  }
  return iso;
}

export function parseMsg(data: Uint8Array): ParsedEmail {
  const streams = topLevelStreams(data);
  const text = (id: string): string => {
    const unicode = streams.get(`__SUBSTG1.0_${id}001F`);
    if (unicode) return new TextDecoder("utf-16le").decode(unicode).replace(/\0+$/, "");
    const ansi = streams.get(`__SUBSTG1.0_${id}001E`);
    return ansi ? new TextDecoder("windows-1252").decode(ansi).replace(/\0+$/, "") : "";
  };
  let body = text("1000");
  const html = streams.get("__SUBSTG1.0_10130102");
  if (!body && html) body = htmlToPlainText(new TextDecoder("utf-8").decode(html));

  const address = text("5D01") || text("0C1F") || text("0065");
  const name = text("0C1A") || text("0042");
  return {
    subject: text("0037"),
    from: name && address && name !== address ? `${name} <${address}>` : name || address,
    to: text("0E04"),
    cc: text("0E03"),
    date: messageTime(streams.get("__PROPERTIES_VERSION1.0")),
    body,
  };
}
