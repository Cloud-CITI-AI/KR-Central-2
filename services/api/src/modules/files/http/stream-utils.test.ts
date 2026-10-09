import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { PayloadTooLargeError } from "../../../platform/errors.js";
import { capBytes, formatLimit, peek, type CapState } from "./stream-utils.js";

async function* chunks(...parts: string[]): AsyncGenerator<Uint8Array> {
  for (const p of parts) yield Buffer.from(p);
  await Promise.resolve();
}
const collect = async (r: Readable): Promise<string> => {
  const out: Buffer[] = [];
  for await (const c of r) out.push(Buffer.from(c as Uint8Array));
  return Buffer.concat(out).toString();
};

describe("peek", () => {
  it("returns the leading bytes and replays them in front of the rest", async () => {
    const { head, stream } = await peek(chunks("ab", "cd", "ef", "gh"), 5);
    expect(head.toString()).toBe("abcde");
    expect(await collect(stream)).toBe("abcdefgh");
  });

  it("returns a short stream whole when it is smaller than the peek", async () => {
    const { head, stream } = await peek(chunks("abc"), 100);
    expect(head.toString()).toBe("abc");
    expect(await collect(stream)).toBe("abc");
  });

  it("handles an empty stream", async () => {
    const { head, stream } = await peek(chunks(), 10);
    expect(head).toHaveLength(0);
    expect(await collect(stream)).toBe("");
  });

  it("releases the source when the replay is destroyed early", async () => {
    let released = false;
    async function* source(): AsyncGenerator<Uint8Array> {
      try {
        yield Buffer.from("abcdef");
        yield Buffer.from("ghijkl");
        yield Buffer.from("mnopqr");
      } finally {
        released = true;
      }
      await Promise.resolve();
    }
    const { stream } = await peek(source(), 4);
    stream.destroy();
    await new Promise((resolve) => setImmediate(resolve));
    expect(released).toBe(true);
  });

  it("rethrows a failure of the source while peeking", async () => {
    async function* failing(): AsyncGenerator<Uint8Array> {
      yield Buffer.from("ab");
      await Promise.resolve();
      throw new Error("client aborted");
    }
    await expect(peek(failing(), 10)).rejects.toThrow("client aborted");
  });
});

describe("capBytes", () => {
  it("passes a stream at the cap and counts it", async () => {
    const state: CapState = { exceeded: false, bytes: 0 };
    const out = Readable.from(capBytes(chunks("abc", "de"), 5, state, "too big"));
    expect(await collect(out)).toBe("abcde");
    expect(state).toEqual({ exceeded: false, bytes: 5 });
  });

  it("fails with a 413 as soon as one byte more arrives, and says so in the state", async () => {
    const state: CapState = { exceeded: false, bytes: 0 };
    const out = Readable.from(capBytes(chunks("abc", "def", "ghi"), 5, state, "x.pdf is larger than 1 MB."));
    await expect(collect(out)).rejects.toThrow(PayloadTooLargeError);
    expect(state.exceeded).toBe(true);
    expect(state.bytes).toBe(6);
  });
});

describe("formatLimit", () => {
  it("writes whole megabytes plainly and others with one decimal", () => {
    expect(formatLimit(50 * 1024 * 1024)).toBe("50 MB");
    expect(formatLimit(1536 * 1024)).toBe("1.5 MB");
    expect(formatLimit(1024)).toBe("0.0 MB");
  });
});
