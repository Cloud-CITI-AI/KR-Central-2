/** What the poller needs from a handler (one per operation type). Handlers are idempotent: a lease expiry re-runs them. */
import type { Logger } from "@kr/logger";
import type { OperationRow, OperationTypeValue } from "@kr/db";

export interface HandlerContext {
  readonly operation: OperationRow;
  /** Aborted when the handler's time limit passes or its lease is lost: stop work and throw. */
  readonly signal: AbortSignal;
  readonly log: Logger;
}

export interface Handler {
  /** Hard limit for one run; the poller records a `timeout` failure when it passes. */
  readonly timeoutMs: number;
  /** Resolves to the value stored as operations.result; throws TaskError to fail with a code and a user-safe message. */
  run(context: HandlerContext): Promise<unknown>;
}

/** The operation types this worker can run; the poller claims only these. */
export type Handlers = Partial<Record<OperationTypeValue, Handler>>;
