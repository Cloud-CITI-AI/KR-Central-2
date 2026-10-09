/**
 * Pure rules for malware scan failures (PRODUCT_SPEC §11, ADR-0011). A scan that cannot give a verdict is never treated
 * as clean: it is retried inside the queue while that can help, then recorded as `error` on the file, and the hourly sweep
 * re-scans files in `error` up to SCAN_ERROR_MAX_RETRIES times.
 */

/** Why a scan gave no verdict. */
export type ScanErrorKind =
  "connection" | "timeout" | "size_limit" | "scanner_error" | "protocol" | "object_missing" | "storage";

/** Stored in files.scan_detail (shown to staff only): fixed text, never clamd output or a storage message. */
const DETAILS: Readonly<Record<ScanErrorKind, string>> = {
  connection: "The virus scanner could not be reached.",
  timeout: "The virus scan timed out.",
  size_limit: "The file is larger than the virus scanner accepts.",
  scanner_error: "The virus scanner reported an error.",
  protocol: "The virus scanner gave an unexpected answer.",
  object_missing: "The stored file could not be found.",
  storage: "The stored file could not be read.",
};

/** Retrying cannot help these: the file is too large for the scanner, or its bytes are gone. */
const PERMANENT: ReadonlySet<ScanErrorKind> = new Set(["size_limit", "object_missing"]);

export interface ScanFailure {
  readonly detail: string;
  /** True when the file must now be recorded as `error`; false when the queue should try the operation again. */
  readonly final: boolean;
}

/** `attempt` is the operation's attempt number (1-based) and `maxAttempts` its limit. */
export function judgeScanError(kind: ScanErrorKind, attempt: number, maxAttempts: number): ScanFailure {
  return { detail: DETAILS[kind], final: PERMANENT.has(kind) || attempt >= maxAttempts };
}

/**
 * `scan_attempts` counts the failed scans of a file. The first failure is not a retry, so with SCAN_ERROR_MAX_RETRIES = 3
 * the file is re-scanned after failure 1, 2 and 3 and is left in `error` after failure 4.
 */
export function mayRescan(failedScans: number, maxRetries: number): boolean {
  return failedScans >= 1 && failedScans <= maxRetries;
}
