/**
 * Object storage contract shared by services/api (uploads, downloads, zip), services/worker (scan, parse, purge) and
 * services/ops (backup). Implementations: S3 adapter (Railway Buckets) and the in-memory fake (`@kr/storage/testing`).
 * Content sniffing (magic bytes via file-type + text/DWG/CFB checks) lives in classify.ts.
 */
import type { Readable } from "node:stream";
import type { FileKind } from "@kr/workflow";

export { SNIFF_BYTES, classifyContent, isAcceptedForSlot } from "./classify.js";
export type { ClassifyResult, ContentRejection } from "./classify.js";
export { decodeMultipartFileName, sanitiseFileName, servedFileName } from "./file-name.js";
export { createS3Storage } from "./s3.js";
export type { S3Storage } from "./s3.js";
export {
  InvalidRangeError,
  ObjectNotFoundError,
  StorageUnavailableError,
  assertValidKey,
  isStorageUnavailable,
} from "./errors.js";

export interface PutObjectInput {
  readonly key: string;
  readonly body: Readable | Uint8Array;
  readonly contentType: string;
  /** Known size in bytes, if available (enables single PUT). */
  readonly size?: number;
}

/** What a streaming put measured while the bytes went by. */
export interface PutObjectResult {
  /** Lowercase hex SHA-256 of the stored bytes. */
  readonly sha256: string;
  readonly size: number;
}

export interface GetObjectResult {
  readonly body: Readable;
  /** Total object size in bytes (not the range length). */
  readonly size: number;
  readonly contentType: string;
  /** Present for ranged reads: the inclusive byte offsets actually served. */
  readonly range?: { readonly start: number; readonly end: number };
  /** Present for ranged reads: the HTTP `Content-Range` value, `bytes <start>-<end>/<size>`. */
  readonly contentRange?: string;
}

export interface ObjectListEntry {
  readonly key: string;
  readonly size: number;
  /** Opaque change token (S3 ETag without quotes). Not a content hash for multipart uploads. */
  readonly etag: string;
  readonly lastModified: Date;
}

export interface ObjectHead extends Omit<ObjectListEntry, "key"> {
  readonly contentType: string;
}

export interface ObjectStorage {
  /** Streams the body to storage, hashing it on the way. Nothing is stored when the body stream fails. */
  put(input: PutObjectInput): Promise<PutObjectResult>;
  /**
   * Range is inclusive byte offsets, like HTTP `Range: bytes=start-end` (an `end` past the object is clamped).
   * Rejects with ObjectNotFoundError, or InvalidRangeError when `start` is past the end of the object.
   */
  get(key: string, range?: { start: number; end?: number }): Promise<GetObjectResult>;
  /** Rejects with ObjectNotFoundError. */
  head(key: string): Promise<ObjectHead>;
  exists(key: string): Promise<boolean>;
  /** Idempotent: deleting a missing key succeeds. */
  delete(key: string): Promise<void>;
  /** Every object whose key starts with `prefix`, in key order, fetched lazily page by page. */
  list(prefix: string, options?: { readonly pageSize?: number }): AsyncIterable<ObjectListEntry>;
  /** Readiness probe (HEAD bucket). */
  ping(): Promise<void>;
}

export interface S3StorageConfig {
  readonly endpoint: string;
  readonly region: string;
  readonly bucket: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly forcePathStyle: boolean;
  /** Socket idle timeout in milliseconds (BE-10); default 30 000. */
  readonly timeoutMs?: number;
  /** Connection timeout in milliseconds; default 10 000. */
  readonly connectTimeoutMs?: number;
}

/** Result of sniffing the first bytes of an upload. */
export interface ContentClassification {
  readonly kind: FileKind;
  /** Canonical media type to store and serve (never the client's declared type). */
  readonly contentType: string;
  /** Canonical extension without dot (pdf, png, jpg, dwg, msg, eml, txt …). */
  readonly extension: string;
}

/** Storage key layout: jobs/<jobId>/<fileId>. Never derived from user input. */
export function objectKeyFor(jobId: string, fileId: string): string {
  return `jobs/${jobId}/${fileId}`;
}
