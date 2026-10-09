/**
 * Reading a stored object into memory for the parse thread, with a size cap (the thread needs the whole document). The cap is
 * checked against the declared size first (to refuse without reading) and then against the bytes actually streamed, so an object
 * that is larger than its metadata says can never fill the heap.
 */
import type { ObjectStorage } from "@kr/storage";
import { TaskError } from "./errors.js";

const tooLarge = (): TaskError => new TaskError("file_too_large", "The file is too large to read.");

export async function readObject(storage: ObjectStorage, key: string, maxBytes: number): Promise<Buffer> {
  const object = await storage.get(key);
  if (object.size > maxBytes) {
    object.body.destroy();
    throw tooLarge();
  }
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for await (const chunk of object.body) {
      const data = Buffer.from(chunk as Uint8Array);
      total += data.length;
      if (total > maxBytes) throw tooLarge();
      chunks.push(data);
    }
  } finally {
    object.body.destroy();
  }
  return Buffer.concat(chunks, total);
}
