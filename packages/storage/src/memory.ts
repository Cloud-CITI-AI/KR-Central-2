import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { InvalidRangeError, ObjectNotFoundError, assertValidKey } from "./errors.js";
import type {
  GetObjectResult,
  ObjectHead,
  ObjectListEntry,
  ObjectStorage,
  PutObjectInput,
  PutObjectResult,
} from "./index.js";

export interface MemoryStorageOptions {
  /** Source of `lastModified`; inject a fixed clock in tests. */
  readonly now?: () => Date;
}

interface StoredObject {
  readonly data: Buffer;
  readonly contentType: string;
  readonly etag: string;
  readonly lastModified: Date;
}

async function readAll(body: PutObjectInput["body"]): Promise<Buffer> {
  if (body instanceof Uint8Array) return Buffer.from(body);
  const chunks: Buffer[] = [];
  for await (const chunk of body) chunks.push(Buffer.from(chunk as Uint8Array | string));
  return Buffer.concat(chunks);
}

const byKey = (a: string, b: string): number => Buffer.compare(Buffer.from(a), Buffer.from(b));

/** Runs synchronous work and turns a throw into a rejection, as the async S3 methods do. */
const attempt = <T>(work: () => T): Promise<T> =>
  new Promise((resolve) => {
    resolve(work());
  });

/** In-memory ObjectStorage with the same observable semantics as the S3 adapter (shared contract suite). */
export function createMemoryStorage(options: MemoryStorageOptions = {}): ObjectStorage {
  const now = options.now ?? ((): Date => new Date());
  const objects = new Map<string, StoredObject>();

  const find = (key: string): StoredObject => {
    assertValidKey(key);
    const found = objects.get(key);
    if (found === undefined) throw new ObjectNotFoundError(key);
    return found;
  };
  const describe = (key: string, o: StoredObject): ObjectListEntry => ({
    key,
    size: o.data.length,
    etag: o.etag,
    lastModified: new Date(o.lastModified),
  });

  return {
    async put(input): Promise<PutObjectResult> {
      assertValidKey(input.key);
      const data = await readAll(input.body); // a failing stream rejects here, before anything is stored
      objects.set(input.key, {
        data,
        contentType: input.contentType,
        etag: createHash("md5").update(data).digest("hex"),
        lastModified: now(),
      });
      return { sha256: createHash("sha256").update(data).digest("hex"), size: data.length };
    },

    get: (key, range) =>
      attempt((): GetObjectResult => {
        const { data, contentType } = find(key);
        if (range === undefined) {
          return { body: Readable.from([Buffer.from(data)], { objectMode: false }), size: data.length, contentType };
        }
        const end = Math.min(range.end ?? data.length - 1, data.length - 1);
        if (!(range.start >= 0) || range.start >= data.length || end < range.start) throw new InvalidRangeError(key);
        return {
          body: Readable.from([Buffer.from(data.subarray(range.start, end + 1))], { objectMode: false }),
          size: data.length,
          contentType,
          range: { start: range.start, end },
          contentRange: `bytes ${range.start}-${end}/${data.length}`,
        };
      }),

    head: (key) =>
      attempt((): ObjectHead => {
        const found = find(key);
        return {
          size: found.data.length,
          contentType: found.contentType,
          etag: found.etag,
          lastModified: new Date(found.lastModified),
        };
      }),

    exists: (key) =>
      attempt(() => {
        assertValidKey(key);
        return objects.has(key);
      }),

    delete: (key) =>
      attempt(() => {
        assertValidKey(key);
        objects.delete(key);
      }),

    list(prefix): AsyncIterable<ObjectListEntry> {
      const entries = [...objects.entries()]
        .filter(([key]) => key.startsWith(prefix))
        .sort(([a], [b]) => byKey(a, b))
        .map(([key, o]) => describe(key, o));
      return Readable.from(entries) as AsyncIterable<ObjectListEntry>;
    },

    ping: () => Promise.resolve(),
  };
}
