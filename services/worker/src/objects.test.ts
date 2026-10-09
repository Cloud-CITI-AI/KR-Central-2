import { Readable } from "node:stream";
import type { ObjectStorage } from "@kr/storage";
import { describe, expect, it } from "vitest";
import { TaskError } from "./errors.js";
import { readObject } from "./objects.js";

/** A storage whose one object has this body and claims this size. */
function storageOf(chunks: string[], declaredSize: number): { storage: ObjectStorage; body: Readable } {
  const body = Readable.from(chunks.map((c) => Buffer.from(c)));
  return { body, storage: { get: () => Promise.resolve({ body, size: declaredSize }) } as unknown as ObjectStorage };
}

describe("readObject", () => {
  it("returns the whole object when it is within the cap", async () => {
    const { storage } = storageOf(["abc", "def"], 6);
    expect((await readObject(storage, "k", 6)).toString()).toBe("abcdef");
  });

  it("refuses an object whose declared size is over the cap without reading it", async () => {
    const { storage, body } = storageOf(["abcdef"], 6);
    await expect(readObject(storage, "k", 5)).rejects.toMatchObject({ code: "file_too_large" });
    expect(body.destroyed).toBe(true);
  });

  it("counts the bytes that actually stream, so an object bigger than its declared size is still refused", async () => {
    const { storage, body } = storageOf(["abc", "def", "ghi"], 3);
    const error = await readObject(storage, "k", 5).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TaskError);
    expect(error).toMatchObject({ code: "file_too_large", retryable: false });
    expect(body.destroyed).toBe(true);
  });

  it("accepts an object that is exactly the cap, whatever size it declared", async () => {
    const { storage } = storageOf(["abc", "de"], 0);
    expect((await readObject(storage, "k", 5)).toString()).toBe("abcde");
  });
});
