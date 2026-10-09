/**
 * Retention rules of the hourly sweeps (PRODUCT_SPEC §11 and §14 "Privacy", DATA_MODEL §5). Pure: every cut-off is
 * computed from the `now` the caller passes.
 */

/** Objects of soft-deleted files are purged this many days after the deletion. */
export const FILE_PURGE_AFTER_DAYS = 30;
/** Sessions are deleted this many days after they expired or were revoked. */
export const SESSION_KEEP_DAYS = 7;
/** Idempotency keys are swept after 24 hours. */
export const IDEMPOTENCY_KEEP_HOURS = 24;
/** A file still `pending` after this long, with no scan queued or running, gets a new scan. */
export const STUCK_SCAN_MINUTES = 15;

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export interface Cutoffs {
  readonly now: Date;
  /** Files deleted before this are purged. */
  readonly filesDeletedBefore: Date;
  /** Sessions that expired or were revoked before this are deleted. */
  readonly sessionsEndedBefore: Date;
  /** Sign-in flows expired before this (they live 10 minutes) are deleted. */
  readonly authFlowsExpiredBefore: Date;
  readonly idempotencyCreatedBefore: Date;
  /** rate_limits.expire is epoch milliseconds. */
  readonly rateLimitsExpiredBeforeMs: number;
  /** Files uploaded before this and still pending are stuck. */
  readonly pendingUploadedBefore: Date;
}

export function cutoffs(now: Date): Cutoffs {
  const before = (ms: number): Date => new Date(now.getTime() - ms);
  return {
    now,
    filesDeletedBefore: before(FILE_PURGE_AFTER_DAYS * DAY_MS),
    sessionsEndedBefore: before(SESSION_KEEP_DAYS * DAY_MS),
    authFlowsExpiredBefore: now,
    idempotencyCreatedBefore: before(IDEMPOTENCY_KEEP_HOURS * HOUR_MS),
    rateLimitsExpiredBeforeMs: now.getTime(),
    pendingUploadedBefore: before(STUCK_SCAN_MINUTES * MINUTE_MS),
  };
}
