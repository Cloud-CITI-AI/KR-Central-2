import { createHash } from "node:crypto";
import { Readable, Transform, pipeline } from "node:stream";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  S3Client,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { InvalidRangeError, ObjectNotFoundError, assertValidKey } from "./errors.js";
import type { ObjectHead, ObjectListEntry, ObjectStorage, PutObjectResult, S3StorageConfig } from "./index.js";

const CONNECT_TIMEOUT_MS = 10_000;
const IDLE_TIMEOUT_MS = 30_000;
/** Multipart parts of 8 MiB (S3 minimum 5 MiB), two in flight: at most ~16 MiB buffered per upload. */
const PART_SIZE = 8 * 1024 * 1024;
const QUEUE_SIZE = 2;
const DEFAULT_CONTENT_TYPE = "application/octet-stream";

export interface S3Storage extends ObjectStorage {
  /** Releases the HTTP connections; call on shutdown. */
  close(): void;
}

const errorName = (e: unknown): string => (e instanceof Error ? e.name : "");
const statusOf = (e: unknown): unknown => (e as { $metadata?: { httpStatusCode?: unknown } }).$metadata?.httpStatusCode;
/** GET reports NoSuchKey; HEAD has no body and reports NotFound. */
const isNotFound = (e: unknown): boolean => ["NoSuchKey", "NotFound"].includes(errorName(e));
const isBadRange = (e: unknown): boolean => errorName(e) === "InvalidRange" || statusOf(e) === 416;

/**
 * S3-compatible ObjectStorage for Railway Buckets. Reads, deletes and listings retry (3 attempts); writes do not,
 * because a consumed stream cannot be replayed. Timeouts: 10 s connect, 30 s socket idle.
 */
export function createS3Storage(config: S3StorageConfig): S3Storage {
  const base: S3ClientConfig = {
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: config.forcePathStyle,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    requestHandler: {
      connectionTimeout: config.connectTimeoutMs ?? CONNECT_TIMEOUT_MS,
      requestTimeout: config.timeoutMs ?? IDLE_TIMEOUT_MS,
      throwOnRequestTimeout: true, // the default is to only log a warning
    },
    // Only checksum when the API demands it: S3-compatible stores differ on the optional CRC headers.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  };
  const reader = new S3Client({ ...base, maxAttempts: 3 });
  const writer = new S3Client({ ...base, maxAttempts: 1 });
  const Bucket = config.bucket;

  const headObject = async (key: string): Promise<ObjectHead> => {
    assertValidKey(key);
    try {
      const out = await reader.send(new HeadObjectCommand({ Bucket, Key: key }));
      return {
        size: out.ContentLength ?? 0,
        contentType: out.ContentType ?? DEFAULT_CONTENT_TYPE,
        etag: (out.ETag ?? "").replaceAll('"', ""),
        lastModified: out.LastModified ?? new Date(0),
      };
    } catch (error) {
      throw isNotFound(error) ? new ObjectNotFoundError(key) : error;
    }
  };

  return {
    async put({ key, body, contentType }): Promise<PutObjectResult> {
      assertValidKey(key);
      const hash = createHash("sha256");
      let size = 0;
      const tap = new Transform({
        transform(chunk: Uint8Array, _encoding, done) {
          hash.update(chunk);
          size += chunk.length;
          done(null, chunk);
        },
      });
      // pipeline() forwards a source failure to `tap`, which fails the upload and aborts the multipart upload.
      pipeline(body instanceof Uint8Array ? Readable.from([body], { objectMode: false }) : body, tap, () => undefined);
      try {
        const upload = new Upload({
          client: writer,
          params: { Bucket, Key: key, Body: tap, ContentType: contentType },
          partSize: PART_SIZE,
          queueSize: QUEUE_SIZE,
        });
        await upload.done();
      } finally {
        tap.destroy(); // releases the source when the upload failed first; a no-op after a complete read
      }
      return { sha256: hash.digest("hex"), size };
    },

    async get(key, range) {
      assertValidKey(key);
      if (range && (!(range.start >= 0) || (range.end !== undefined && range.end < range.start))) {
        throw new InvalidRangeError(key); // S3 would silently ignore a malformed Range and return everything
      }
      try {
        const Range = range && `bytes=${range.start}-${range.end ?? ""}`;
        const out = await reader.send(new GetObjectCommand({ Bucket, Key: key, ...(Range && { Range }) }));
        if (!(out.Body instanceof Readable)) throw new Error("S3 returned a body that is not a Node stream");
        const contentType = out.ContentType ?? DEFAULT_CONTENT_TYPE;
        if (range === undefined) return { body: out.Body, size: out.ContentLength ?? 0, contentType };
        const served = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(out.ContentRange ?? "");
        if (!served) throw new Error("S3 ignored the Range header");
        return {
          body: out.Body,
          size: Number(served[3]),
          contentType,
          range: { start: Number(served[1]), end: Number(served[2]) },
          contentRange: served[0],
        };
      } catch (error) {
        if (isNotFound(error)) throw new ObjectNotFoundError(key);
        throw isBadRange(error) ? new InvalidRangeError(key) : error;
      }
    },

    head: headObject,

    async exists(key) {
      try {
        await headObject(key);
        return true;
      } catch (error) {
        if (error instanceof ObjectNotFoundError) return false;
        throw error;
      }
    },

    async delete(key) {
      assertValidKey(key);
      await reader.send(new DeleteObjectCommand({ Bucket, Key: key })); // S3 answers 204 for a missing key
    },

    async *list(prefix, options): AsyncGenerator<ObjectListEntry> {
      let ContinuationToken: string | undefined;
      do {
        const page = await reader.send(
          new ListObjectsV2Command({ Bucket, Prefix: prefix, ContinuationToken, MaxKeys: options?.pageSize }),
        );
        for (const item of page.Contents ?? []) {
          if (item.Key === undefined) continue;
          yield {
            key: item.Key,
            size: item.Size ?? 0,
            etag: (item.ETag ?? "").replaceAll('"', ""),
            lastModified: item.LastModified ?? new Date(0),
          };
        }
        ContinuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
      } while (ContinuationToken !== undefined);
    },

    async ping() {
      await reader.send(new HeadBucketCommand({ Bucket }));
    },

    close() {
      reader.destroy();
      writer.destroy();
    },
  };
}
