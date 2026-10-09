/**
 * How a handler reports a failure to the poller. `code` is stored in operations.error_code and `message` in
 * operations.error_message: the API relays `message` to the user only when it is short plain prose (operation-view.ts),
 * so it must be person-oriented and must never carry document content, paths or a stack. `retryable` failures go back
 * on the queue with back-off until max_attempts; the others fail the operation at once.
 */
export class TaskError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(code: string, message: string, options: { readonly retryable?: boolean; readonly cause?: unknown } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "TaskError";
    this.code = code;
    this.retryable = options.retryable ?? false;
  }
}

/** Shown for a failure nobody planned for (the cause is logged, never stored). */
export const UNEXPECTED_FAILURE =
  "The task could not be completed. Try again, or contact KR Surveys if it keeps failing.";

/** The failure to record for any thrown value: a TaskError as it is, anything else as a retryable internal error. */
export function toFailure(error: unknown): { code: string; message: string; retryable: boolean } {
  if (error instanceof TaskError) return { code: error.code, message: error.message, retryable: error.retryable };
  return { code: "internal_error", message: UNEXPECTED_FAILURE, retryable: true };
}
