/**
 * Wires the `migrate` Railway service: health endpoint first (503 while working), then pending check, dump, migrate.
 * `done` settles when the job has; the entry point exits 1 when it rejects. Nothing here reads process.env (config.ts does).
 */
import { migrate } from "@kr/db";
import type { Logger } from "@kr/logger";
import type { ObjectStorage } from "@kr/storage";
import type { MigrateConfig } from "./config.js";
import { startHealthServer, type MigrateStatus } from "./health-server.js";
import { runMigrationJob, type Clock, type MigrateOutcome } from "./migrate-job.js";
import { dumpToStorage } from "./pg-dump.js";
import { withSslMode } from "./pg-url.js";
import { findPendingMigrations } from "./pending.js";

export interface MigrateServiceDeps {
  readonly config: MigrateConfig;
  readonly log: Logger;
  /** The backup bucket. */
  readonly storage: Pick<ObjectStorage, "put" | "head">;
  readonly clock: Clock;
  /** Migrations directory; defaults to the one shipped in @kr/db (tests point it at a temporary copy). */
  readonly migrationsDir?: string;
}

export interface MigrateService {
  readonly port: number;
  readonly status: () => MigrateStatus;
  /** Resolves with the outcome once migrations succeeded (the endpoint is then 200); rejects when any step failed. */
  readonly done: Promise<MigrateOutcome>;
  close(): Promise<void>;
}

export async function startMigrateService(deps: MigrateServiceDeps): Promise<MigrateService> {
  const { config, log } = deps;
  let status: MigrateStatus = "migrating";
  const health = await startHealthServer({
    host: config.HOST,
    port: config.PORT,
    release: config.RELEASE_VERSION,
    getStatus: () => status,
  });
  log.info(
    { event: "ops_migrate_started", port: health.port, release: config.RELEASE_VERSION },
    "Migrate service started",
  );

  const done = runMigrationJob({
    release: config.RELEASE_VERSION,
    clock: deps.clock,
    log,
    findPending: () =>
      findPendingMigrations({
        connectionString: config.MIGRATION_DATABASE_URL,
        ssl: config.DATABASE_SSL,
        ...(deps.migrationsDir !== undefined && { dir: deps.migrationsDir }),
      }),
    backup: (key) =>
      dumpToStorage({
        storage: deps.storage,
        key,
        pgDumpPath: config.PG_DUMP_PATH,
        databaseUrl: config.MIGRATION_DATABASE_URL,
        ssl: config.DATABASE_SSL,
      }),
    apply: () =>
      migrate({
        connectionString: withSslMode(config.MIGRATION_DATABASE_URL, config.DATABASE_SSL),
        ...(deps.migrationsDir !== undefined && { dir: deps.migrationsDir }),
        log: (message) => {
          log.info({ event: "ops_migration_applying" }, message);
        },
      }),
  }).then(
    (outcome) => {
      status = "ready";
      return outcome;
    },
    (error: unknown) => {
      status = "failed";
      throw error;
    },
  );
  done.catch(() => undefined); // the caller awaits `done`; this only prevents an unhandled rejection in between

  return { port: health.port, status: () => status, done, close: () => health.close() };
}
