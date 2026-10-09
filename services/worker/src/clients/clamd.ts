/**
 * clamd client (ADR-0011): streams an object to `INSTREAM` over TCP in length-prefixed chunks and reads the verdict.
 * Every call has a socket idle timeout (CLAMAV_TIMEOUT_MS), and a stream larger than CLAMAV_STREAM_MAX_BYTES is refused
 * before clamd would cut it off (clamd's own StreamMaxLength is set at least as high, infra/clamav/clamd.conf).
 * Uses the null-terminated `z` command form, so replies are unambiguous.
 */
import net from "node:net";
import type { Readable } from "node:stream";

/** One INSTREAM frame carries at most this many bytes. */
export const CHUNK_BYTES = 64 * 1024;

export type ClamdErrorCode = "connection" | "timeout" | "size_limit" | "scanner_error" | "protocol" | "aborted";

/** A scan that could not give a verdict. `detail` is clamd's own text (signature database names and limits, no file data). */
export class ClamdError extends Error {
  readonly code: ClamdErrorCode;
  readonly detail: string;

  constructor(code: ClamdErrorCode, message: string, detail = "") {
    super(message);
    this.name = "ClamdError";
    this.code = code;
    this.detail = detail;
  }
}

export type ScanVerdict = { readonly status: "clean" } | { readonly status: "infected"; readonly signature: string };

export interface ClamdOptions {
  readonly host: string;
  readonly port: number;
  readonly timeoutMs: number;
  readonly maxBytes: number;
}

export interface ClamdClient {
  /** True when clamd answers PONG (false for any failure: this is a probe). */
  ping(): Promise<boolean>;
  /** Streams `body` to clamd. Rejects with ClamdError (or the body stream's own error) when there is no verdict. */
  scan(body: Readable, signal?: AbortSignal): Promise<ScanVerdict>;
}

const frame = (data: Uint8Array): Buffer => {
  const header = Buffer.alloc(4);
  header.writeUInt32BE(data.length);
  return Buffer.concat([header, data]);
};

/** Resolves when the socket is writable again, or at once when it closed meanwhile. */
const drained = (socket: net.Socket): Promise<void> =>
  new Promise((resolve) => {
    socket.once("drain", resolve);
    socket.once("close", resolve);
  });

async function feed(socket: net.Socket, body: Readable, maxBytes: number): Promise<void> {
  let total = 0;
  for await (const piece of body) {
    const data = Buffer.from(piece as Uint8Array);
    for (let offset = 0; offset < data.length; offset += CHUNK_BYTES) {
      const chunk = data.subarray(offset, offset + CHUNK_BYTES);
      total += chunk.length;
      if (total > maxBytes) throw new ClamdError("size_limit", "The file is larger than the scan limit.");
      if (socket.destroyed) return; // clamd already answered (for example a limit error): the reply decides
      if (!socket.write(frame(chunk))) await drained(socket);
    }
  }
  if (!socket.destroyed) socket.write(Buffer.alloc(4)); // a zero-length chunk ends the stream
}

function verdictFrom(reply: string): ScanVerdict {
  const found = /^stream: (.+) FOUND$/.exec(reply);
  if (found?.[1]) return { status: "infected", signature: found[1].slice(0, 200) };
  if (reply === "stream: OK") return { status: "clean" };
  if (/size limit exceeded/i.test(reply))
    throw new ClamdError("size_limit", "clamd refused the stream as too large.", reply);
  if (reply.endsWith("ERROR")) throw new ClamdError("scanner_error", "clamd reported an error.", reply.slice(0, 200));
  throw new ClamdError("protocol", "clamd sent an unexpected reply.", reply.slice(0, 200));
}

export function createClamdClient(options: ClamdOptions): ClamdClient {
  /** One command on a fresh connection; resolves with clamd's reply text, whatever way the connection ended. */
  function exchange(command: string, source?: Readable, signal?: AbortSignal): Promise<string> {
    if (signal?.aborted) return Promise.reject(new ClamdError("aborted", "The scan was cancelled."));
    return new Promise((resolve, reject) => {
      const socket = net.connect({ host: options.host, port: options.port });
      socket.setTimeout(options.timeoutMs);
      const replies: Buffer[] = [];
      let settled = false;
      const settle = (outcome: () => void): void => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener("abort", onAbort);
        source?.destroy();
        socket.destroy();
        outcome();
      };
      const reply = (): string => Buffer.concat(replies).toString("utf8").replace(/\0$/, "").trim();
      const onAbort = (): void => {
        settle(() => {
          reject(new ClamdError("aborted", "The scan was cancelled."));
        });
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      socket.on("data", (chunk: Buffer) => replies.push(chunk));
      socket.on("timeout", () => {
        settle(() => {
          reject(new ClamdError("timeout", "clamd did not answer in time."));
        });
      });
      socket.on("close", () => {
        settle(() => {
          resolve(reply());
        });
      });
      // A reset after clamd already answered (it closes early on a limit error) still has a reply to read.
      socket.on("error", (error: NodeJS.ErrnoException) => {
        settle(() => {
          if (replies.length > 0) resolve(reply());
          else reject(new ClamdError("connection", "clamd could not be reached.", error.code ?? ""));
        });
      });
      socket.write(`z${command}\0`);
      if (source) {
        feed(socket, source, options.maxBytes).catch((error: unknown) => {
          settle(() => {
            reject(error instanceof Error ? error : new ClamdError("protocol", "The scan failed."));
          });
        });
      }
    });
  }

  return {
    ping: async () => (await exchange("PING").catch(() => "")) === "PONG",
    scan: async (body, signal) => verdictFrom(await exchange("INSTREAM", body, signal)),
  };
}
