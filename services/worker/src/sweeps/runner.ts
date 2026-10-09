/**
 * The hourly sweeps (PRODUCT_SPEC §11, ADR-0006). One worker at a time runs them: a session-level Postgres advisory lock is
 * taken on a dedicated connection and released when the sweep ends (or the connection dies), so two workers never sweep
 * together. A failing task is logged and the others still run. The sweeps are idempotent, so running twice is harmless.
 */
import type { Db } from "@kr/db";
import type { Logger } from "@kr/logger";
import { sql } from "kysely";
import { systemClock, type Clock } from "../clock.js";
import { describeError } from "../errors.js";
import { cutoffs, type Cutoffs } from "../domain/retention.js";

export const SWEEP_LOCK_KEY = 7_154_001;
export const SWEEP_INTERVAL_MS = 60 * 60 * 1000;
/** The first sweep runs this long after start, so a restart loop does not sweep every few seconds. */
export const FIRST_SWEEP_DELAY_MS = 60_000;

export interface SweepTask {
  readonly name: string;
  /** Returns counts for the log (rows deleted, files purged ...). */
  run(cutoffs: Cutoffs): Promise<Record<string, number>>;
}

export type SweepReport = Record<string, Record<string, number> | "failed">;

export interface SweeperOptions {
  readonly db: Db;
  readonly log: Logger;
  readonly tasks: readonly SweepTask[];
  readonly clock?: Clock;
  readonly intervalMs?: number;
  readonly firstDelayMs?: number;
}

export interface Sweeper {
  /** One sweep now; "skipped" when another worker holds the lock. */
  runOnce(): Promise<SweepReport | "skipped">;
  start(): void;
  /** Cancels the schedule and waits for a sweep in progress. */
  stop(): Promise<void>;
}

export function createSweeper(o: SweeperOptions): Sweeper {
  const clock = o.clock ?? systemClock;
  let timer: NodeJS.Timeout | undefined;
  let running: Promise<unknown> = Promise.resolve();
  let stopped = false;

  async function runTasks(): Promise<SweepReport> {
    const report: SweepReport = {};
    const limits = cutoffs(clock.now());
    for (const task of o.tasks) {
      try {
        report[task.name] = await task.run(limits);
      } catch (err) {
        report[task.name] = "failed";
        o.log.error({ event: "sweep_task_failed", task: task.name, ...describeError(err) }, "A sweep task failed");
      }
    }
    return report;
  }

  async function runOnce(): Promise<SweepReport | "skipped"> {
    return o.db.connection().execute(async (conn) => {
      const lock = await sql<{
        locked: boolean;
      }>`select pg_try_advisory_lock(${SWEEP_LOCK_KEY}::bigint) as locked`.execute(conn);
      if (!lock.rows[0]?.locked) return "skipped";
      try {
        const report = await runTasks();
        o.log.info({ event: "sweep_completed", report }, "Sweep completed");
        return report;
      } finally {
        await sql`select pg_advisory_unlock(${SWEEP_LOCK_KEY}::bigint)`.execute(conn);
      }
    });
  }

  function schedule(delayMs: number): void {
    if (stopped) return;
    timer = setTimeout(() => {
      running = runOnce()
        .catch((err: unknown) => {
          o.log.error({ event: "sweep_failed", ...describeError(err) }, "The sweep could not run");
        })
        .finally(() => {
          schedule(o.intervalMs ?? SWEEP_INTERVAL_MS);
        });
    }, delayMs);
  }

  return {
    runOnce,
    start: () => {
      schedule(o.firstDelayMs ?? FIRST_SWEEP_DELAY_MS);
    },
    stop: async () => {
      stopped = true;
      clearTimeout(timer);
      await running;
    },
  };
}
