/**
 * The backup bucket's `manifest.json`: per source key, the size and etag it was copied at and since when the source has
 * been gone (domain/object-sync.ts). A missing manifest is a first run; an unreadable one fails the run loudly instead of
 * starting over (delete the object to rebuild it: copies found without a record start their retention clock again).
 */
import type { Readable } from "node:stream";
import { ObjectNotFoundError, type ObjectStorage } from "@kr/storage";
import { z } from "zod";
import type { Manifest } from "./domain/object-sync.js";
import { MANIFEST_KEY } from "./domain/keys.js";

const ManifestFile = z.object({
  version: z.literal(1),
  updatedAt: z.iso.datetime(),
  objects: z.record(
    z.string(),
    z.object({
      size: z.number().int().nonnegative(),
      etag: z.string(),
      copiedAt: z.iso.datetime(),
      missingSince: z.iso.datetime().nullable(),
    }),
  ),
});

export class ManifestError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ManifestError";
  }
}

async function readAll(body: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of body) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

export async function loadManifest(storage: Pick<ObjectStorage, "get">): Promise<Manifest> {
  let bytes: Buffer;
  try {
    bytes = await readAll((await storage.get(MANIFEST_KEY)).body);
  } catch (error) {
    if (error instanceof ObjectNotFoundError) return {};
    throw error;
  }
  try {
    return ManifestFile.parse(JSON.parse(bytes.toString("utf8"))).objects;
  } catch (cause) {
    throw new ManifestError(`${MANIFEST_KEY} in the backup bucket is unreadable; fix or delete it`, { cause });
  }
}

export async function saveManifest(storage: Pick<ObjectStorage, "put">, objects: Manifest, now: Date): Promise<void> {
  const file = { version: 1, updatedAt: now.toISOString(), objects };
  await storage.put({
    key: MANIFEST_KEY,
    body: Buffer.from(JSON.stringify(file)),
    contentType: "application/json",
  });
}
