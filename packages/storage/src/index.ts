/**
 * Object storage contract shared by services/api (uploads, downloads, zip) and services/worker (scan, parse, purge).
 * Implementation (WP-06): S3 adapter over @aws-sdk/client-s3 + lib-storage (Railway Buckets are S3-compatible),
 * an in-memory fake for unit tests, and content sniffing (magic bytes via file-type + text/DWG/CFB checks).
 */
import type { Readable } from "node:stream";
import type { FileKind } from "@kr/workflow";

export interface PutObjectInput {
  readonly key: string;
  readonly body: Readable | Uint8Array;
  readonly contentType: string;
  /** Known size in bytes, if available (enables single PUT). */
  readonly size?: number;
}

export interface GetObjectResult {
  readonly body: Readable;
  /** Total object size in bytes. */
  readonly size: number;
  readonly contentType: string;
  /** Present for ranged reads. */
  readonly range?: { readonly start: number; readonly end: number };
}

export interface ObjectStorage {
  put(input: PutObjectInput): Promise<void>;
  /** Range is inclusive byte offsets, like HTTP Range. Rejects with ObjectNotFoundError. */
  get(key: string, range?: { start: number; end?: number }): Promise<GetObjectResult>;
  delete(key: string): Promise<void>;
  /** Readiness probe (HEAD bucket). */
  ping(): Promise<void>;
}

export class ObjectNotFoundError extends Error {
  constructor(readonly key: string) {
    super(`Object not found: ${key}`);
    this.name = "ObjectNotFoundError";
  }
}

export interface S3StorageConfig {
  readonly endpoint: string;
  readonly region: string;
  readonly bucket: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly forcePathStyle: boolean;
  /** Per-request timeout (BE-10). */
  readonly timeoutMs?: number;
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
