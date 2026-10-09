/**
 * The operations poller (ADR-0006): `concurrency` loops claim due operations (FOR UPDATE SKIP LOCKED, under a lease), run
 * the handler of their type and record the outcome. Idle loops back off; expired leases are re-queued on a timer.
 */
import {
  claimNextOperation,
  completeOperation,
  failOperation,
  requeueExpiredLeases,
  type Db,
  type OperationRow,
  type OperationTypeValue,
} from "@kr/db";
import type { Logger } from "@kr/logger";
import type { KrMetrics } from "@kr/telemetry";
import { systemClock, type Clock } from "./clock.js";
import { TaskError, describeError, toFailure } from "./errors.js";
import type { Handlers } from "./handlers/types.js";
import { sleep } from "./timing.js";

export const MAX_IDLE_DELAY_MS = 5000;
export const REQUEUE_INTERVAL_MS = 30_000;

export interface PollerOptions {
  readonly db: Db;
  /** Unique per process: it is the lease owner (operations.locked_by). */
  readonly workerId: string;
  readonly handlers: Handlers;
  readonly log: Logger;
  readonly metrics: Pick<KrMetrics<OperationTypeValue, "succeeded" | "failed">, "recordOperation">;
  readonly concurrency: number;
  readonly pollIntervalMs: number;
  readonly leaseSeconds: number;
  readonly clock?: Clock;
  readonly requeueIntervalMs?: number;
}

export class Poller {
  private readonly o: PollerOptions;
  private readonly clock: Clock;
  private readonly types: OperationTypeValue[];
  private readonly stopSignal = new AbortController();
  private loops: Promise<void>[] = [];
  private requeueTimer: NodeJS.Timeout | undefined;

  constructor(options: PollerOptions) {
    this.o = options;
    this.clock = options.clock ?? systemClock;
    this.types = Object.keys(options.handlers) as OperationTypeValue[];
  }

  get draining(): boolean {
    return this.stopSignal.signal.aborted;
  }

  start(): void {
    void this.requeue();
    this.requeueTimer = setInterval(() => void this.requeue(), this.o.requeueIntervalMs ?? REQUEUE_INTERVAL_MS);
    this.loops = Array.from({ length: this.o.concurrency }, () => this.loop());
  }

  /**
   * Stop claiming and wait for in-flight operations: true when they all finished within `timeoutMs`.
   */
  async stop(timeoutMs: number): Promise<boolean> {
    this.stopSignal.abort();
    clearInterval(this.requeueTimer);
    const timeout = new AbortController();
    const finished = Promise.all(this.loops).then(() => true);
    const drained = await Promise.race([finished, sleep(timeoutMs, timeout.signal).then(() => false)]);
    timeout.abort();
    return drained;
  }

  private async requeue(): Promise<void> {
    try {
      const n = await requeueExpiredLeases(this.o.db);
      if (n > 0) this.o.log.warn({ event: "leases_requeued", count: n }, "Re-queued operations whose lease expired");
    } catch (err) {
      this.o.log.warn({ event: "requeue_failed", ...describeError(err) }, "Could not re-queue expired leases");
    }
  }

  private async loop(): Promise<void> {
    if (this.types.length === 0) return;
    let idle = 0;
    while (!this.draining) {
      let op: OperationRow | undefined;
      try {
        op = await claimNextOperation(this.o.db, this.o.workerId, this.o.leaseSeconds, this.types);
      } catch (err) {
        this.o.log.warn({ event: "claim_failed", ...describeError(err) }, "Could not claim an operation");
      }
      if (op) {
        idle = 0;
        await this.process(op);
      } else {
        const delay = Math.min(this.o.pollIntervalMs * 2 ** idle, Math.max(MAX_IDLE_DELAY_MS, this.o.pollIntervalMs));
        idle = Math.min(idle + 1, 10);
        await sleep(delay, this.stopSignal.signal);
      }
    }
  }

  private async process(op: OperationRow): Promise<void> {
    const handler = this.o.handlers[op.type];
    const log = this.o.log.child({ operationId: op.id, type: op.type, jobId: op.job_id, attempt: op.attempts });
    let outcome: { readonly ok: true; readonly result: unknown } | { readonly ok: false; readonly error: unknown };
    try {
      if (!handler) throw new TaskError("unsupported_operation", "This kind of task is not available.");
      outcome = { ok: true, result: await handler.run({ operation: op, signal: this.stopSignal.signal, log }) };
    } catch (error) {
      outcome = { ok: false, error };
    }
    try {
      await this.record(op, outcome, log);
    } catch (err) {
      log.error(
        { event: "record_failed", ...describeError(err) },
        "Could not record the outcome; the lease will expire",
      );
    }
  }

  /** Complete or fail the operation (only the lease holder may) and count it once it is final. */
  private async record(
    op: OperationRow,
    outcome: { readonly ok: true; readonly result: unknown } | { readonly ok: false; readonly error: unknown },
    log: Logger,
  ): Promise<void> {
    const { db, workerId, metrics } = this.o;
    const seconds = (this.clock.now().getTime() - op.created_at.getTime()) / 1000;
    if (outcome.ok) {
      if (await completeOperation(db, op.id, workerId, outcome.result)) {
        metrics.recordOperation({ type: op.type, status: "succeeded", durationSeconds: seconds });
        log.info({ event: "operation_succeeded" }, "Operation succeeded");
      } else log.warn({ event: "complete_lost" }, "The operation was no longer ours when it finished");
      return;
    }
    const failure = toFailure(outcome.error);
    const result = await failOperation(db, op.id, workerId, failure);
    const fields = { code: failure.code, outcome: result, ...describeError(outcome.error) };
    if (result === "lost")
      log.warn({ event: "fail_lost", ...fields }, "The operation was no longer ours when it failed");
    else if (result === "requeued")
      log.warn({ event: "operation_requeued", ...fields }, "Operation failed; it will be retried");
    else {
      metrics.recordOperation({ type: op.type, status: "failed", durationSeconds: seconds });
      log.error({ event: "operation_failed", ...fields }, "Operation failed");
    }
  }
}
