/**
 * Reading the conformance stamp from a picture of page 1 (ADR-0010). The worker depends on this interface only; the
 * Anthropic implementation is in anthropic-stamp-reader.ts and tests use a fake. A reader never blocks a user: every
 * failure is a StampReaderError and the conformed-date reading falls through to the text rule.
 */

export interface StampReading {
  /** True only when a stamped date was read and it is a real calendar date. */
  readonly found: boolean;
  /** ISO yyyy-mm-dd when found. */
  readonly date: string | null;
  /** The stamp as printed, e.g. "DATE 16-Mar-2026 FILE 123-26" (200 characters at most). */
  readonly stampText: string | null;
}

/** Closed set, shared with the kr.ai.stamp_reading metric. */
export type StampFailure = "refused" | "timeout" | "unparseable" | "error";

export class StampReaderError extends Error {
  readonly reason: StampFailure;
  /** True when the service itself was down or unreachable (connection error, timeout, 5xx, 429, open circuit): counts toward the circuit breaker. */
  readonly unavailable: boolean;

  constructor(reason: StampFailure, options?: { readonly cause?: unknown; readonly unavailable?: boolean }) {
    super(
      `The stamp could not be read (${reason}).`,
      options?.cause === undefined ? undefined : { cause: options.cause },
    );
    this.name = "StampReaderError";
    this.reason = reason;
    this.unavailable = options?.unavailable ?? false;
  }
}

export interface StampReader {
  /** `png` is page 1 rendered by the worker. Rejects with StampReaderError (or the caller's abort reason). */
  read(png: Uint8Array, signal?: AbortSignal): Promise<StampReading>;
}
