/**
 * Assembles the running worker from its dependencies: the health server, the poller, the hourly sweeps and the queue gauges. main.ts
 * creates the real dependencies; tests pass a test database, an in-memory store and their own handlers.
 */
import type { Db } from "@kr/db";
import type { Logger } from "@kr/logger";
import type { ObjectStorage } from "@kr/storage";
import type { KrMetrics } from "@kr/telemetry";
import type { OperationTypeValue } from "@kr/db";
import { sql } from "kysely";
import type { Clock } from "./clock.js";
import type { WorkerConfig } from "./config.js";
import { readQueue } from "./data/operations.js";
import type { Handlers } from "./handlers/types.js";
import { Poller } from "./poller.js";
import { createSweeper } from "./sweeps/runner.js";
import { buildSweepTasks } from "./sweeps/index.js";
import { startHealthServer, type HealthServer } from "./runtime/health.js";

export interface WorkerDeps {
  readonly config: Pick<
    WorkerConfig,
    | "HOST"
    | "PORT"
    | "WORKER_CONCURRENCY"
    | "WORKER_POLL_INTERVAL_MS"
    | "WORKER_LEASE_SECONDS"
    | "SCAN_ERROR_MAX_RETRIES"
  >;
  readonly db: Db;
  readonly storage: ObjectStorage;
  readonly log: Logger;
  readonly metrics: KrMetrics<OperationTypeValue, "succeeded" | "failed">;
  readonly clock: Clock;
  readonly workerId: string;
  readonly handlers: Handlers;
  /** Test seam: when the first sweep runs and how often (default: after 60 s, then hourly). */
  readonly sweepTiming?: { readonly firstDelayMs: number; readonly intervalMs: number };
}

export interface RunningWorker {
  readonly healthPort: number;
  /** Stops claiming and waits for in-flight work; false when it did not finish within `timeoutMs`. */
  drain(timeoutMs: number): Promise<boolean>;
  /** Stops the health server and the queue gauges (after drain). */
  close(): Promise<void>;
}

export async function startWorker(deps: WorkerDeps): Promise<RunningWorker> {
  const { config, db, storage, log, metrics } = deps;
  const poller = new Poller({
    db,
    workerId: deps.workerId,
    handlers: deps.handlers,
    log,
    metrics,
    clock: deps.clock,
    concurrency: config.WORKER_CONCURRENCY,
    pollIntervalMs: config.WORKER_POLL_INTERVAL_MS,
    leaseSeconds: config.WORKER_LEASE_SECONDS,
  });
  const sweeper = createSweeper({
    db,
    log,
    clock: deps.clock,
    tasks: buildSweepTasks({ db, storage, log, maxScanRetries: config.SCAN_ERROR_MAX_RETRIES }),
    ...deps.sweepTiming,
  });
  const health: HealthServer = await startHealthServer({
    host: config.HOST,
    port: config.PORT,
    probes: { database: () => sql`select 1`.execute(db), storage: () => storage.ping() },
    isDraining: () => poller.draining,
  });
  const unobserve = [
    metrics.observeQueueDepth(async () => (await readQueue(db)).depth),
    metrics.observeQueueAge(async () => (await readQueue(db)).age),
  ];
  poller.start();
  sweeper.start();
  log.info(
    { event: "worker_started", workerId: deps.workerId, port: health.port, types: Object.keys(deps.handlers) },
    "Worker started",
  );
  return {
    healthPort: health.port,
    drain: async (timeoutMs) => {
      const startedAt = deps.clock.now().getTime();
      const polled = await poller.stop(timeoutMs);
      const sweeping = await sweeper.stop(Math.max(0, timeoutMs - (deps.clock.now().getTime() - startedAt)));
      return polled && sweeping;
    },
    close: async () => {
      for (const stop of unobserve) stop();
      await health.close();
    },
  };
}
