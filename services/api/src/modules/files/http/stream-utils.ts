/** Stream helpers for uploads: a byte cap that fails the stream, and a peek that does not lose the peeked bytes. */
import { Readable } from "node:stream";
import { PayloadTooLargeError } from "../../../platform/errors.js";

export interface CapState {
  /** True once the source delivered more than the cap. */
  exceeded: boolean;
  /** Bytes seen so far (including the chunk that crossed the cap). */
  bytes: number;
}

/** Re-emits `source` and fails with a 413 as soon as more than `maxBytes` have arrived (the rest is never read). */
export async function* capBytes(
  source: AsyncIterable<Uint8Array>,
  maxBytes: number,
  state: CapState,
  tooLargeDetail: string,
): AsyncGenerator<Uint8Array> {
  for await (const chunk of source) {
    state.bytes += chunk.length;
    if (state.bytes > maxBytes) {
      state.exceeded = true;
      throw new PayloadTooLargeError({ detail: tooLargeDetail });
    }
    yield chunk;
  }
}

export interface Peeked {
  /** At most `bytes` leading bytes (fewer when the stream is shorter). */
  readonly head: Buffer;
  /** The whole stream again, peeked bytes included. Destroying it releases the source. */
  readonly stream: Readable;
}

/** Read the first `bytes` bytes without consuming them: `stream` replays them before the rest of the source. */
export async function peek(source: AsyncIterable<Uint8Array>, bytes: number): Promise<Peeked> {
  const it = source[Symbol.asyncIterator]();
  const buffered: Buffer[] = [];
  let length = 0;
  let finished = false;
  try {
    while (length < bytes) {
      const next = await it.next();
      if (next.done) {
        finished = true;
        break;
      }
      const chunk = Buffer.from(next.value);
      buffered.push(chunk);
      length += chunk.length;
    }
  } catch (error) {
    await it.return?.();
    throw error;
  }
  const replay = Buffer.concat(buffered);
  async function* generate(): AsyncGenerator<Uint8Array> {
    try {
      if (replay.length > 0) yield replay;
      while (!finished) {
        const next = await it.next();
        if (next.done) return;
        yield next.value;
      }
    } finally {
      await it.return?.();
    }
  }
  const stream = Readable.from(generate(), { objectMode: false });
  // A replay destroyed before it started never runs `generate`'s finally, so release the source on close as well.
  stream.once("close", () => {
    // Nobody is left to report a failing cleanup to: the request that owns the source reports its own failures.
    void it.return?.().catch(() => undefined);
  });
  return { head: replay.subarray(0, bytes), stream };
}

/** "50 MB" for a byte limit (whole MiB; one decimal otherwise), as in the spec's "<name> is larger than 50 MB". */
export function formatLimit(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return `${Number.isInteger(mb) ? mb : mb.toFixed(1)} MB`;
}
