/** Reading a stored object into memory for the parse thread, with a size cap (the thread needs the whole document). */
import type { ObjectStorage } from "@kr/storage";
import { TaskError } from "./errors.js";

export async function readObject(storage: ObjectStorage, key: string, maxBytes: number): Promise<Buffer> {
  const object = await storage.get(key);
  if (object.size > maxBytes) {
    object.body.destroy();
    throw new TaskError("file_too_large", "The file is too large to read.");
  }
  const chunks: Buffer[] = [];
  for await (const chunk of object.body) chunks.push(Buffer.from(chunk as Uint8Array));
  return Buffer.concat(chunks);
}
