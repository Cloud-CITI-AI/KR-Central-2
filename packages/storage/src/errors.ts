export class ObjectNotFoundError extends Error {
  constructor(readonly key: string) {
    super(`Object not found: ${key}`);
    this.name = "ObjectNotFoundError";
  }
}

export class InvalidRangeError extends Error {
  constructor(readonly key: string) {
    super(`Range not satisfiable for object: ${key}`);
    this.name = "InvalidRangeError";
  }
}

/** S3 keys are 1 to 1024 UTF-8 bytes; both adapters enforce it so the fake fails where the real thing would. */
export function assertValidKey(key: string): void {
  const bytes = Buffer.byteLength(key);
  if (bytes < 1 || bytes > 1024) throw new RangeError("Object key must be 1 to 1024 bytes long");
}

/**
 * The bucket could not be reached or did not answer in time (connection refused or reset, DNS failure, timeout, 5xx).
 * Callers answer 503 and ask the person to try again; it is not a bug in the request or in the object.
 */
export class StorageUnavailableError extends Error {
  constructor(cause: unknown) {
    super("Object storage is unavailable", { cause });
    this.name = "StorageUnavailableError";
  }
}

const UNAVAILABLE_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EPIPE",
]);
const UNAVAILABLE_NAMES = new Set(["TimeoutError", "RequestTimeout", "RequestTimeoutException", "ServiceUnavailable"]);

/** Connection, timeout and server-side (5xx, throttling) failures of an S3 call, looking through causes and AggregateError. */
export function isStorageUnavailable(error: unknown, depth = 0): boolean {
  if (!(error instanceof Error) || depth > 3) return false;
  if (error instanceof StorageUnavailableError) return true;
  const { code, $metadata } = error as { code?: unknown; $metadata?: { httpStatusCode?: unknown } };
  if (typeof code === "string" && UNAVAILABLE_CODES.has(code)) return true;
  if (UNAVAILABLE_NAMES.has(error.name)) return true;
  const status = $metadata?.httpStatusCode;
  if (typeof status === "number" && (status >= 500 || status === 429)) return true;
  const inner: unknown[] = error instanceof AggregateError ? (error.errors as unknown[]) : [];
  return [error.cause, ...inner].some((e) => isStorageUnavailable(e, depth + 1));
}
