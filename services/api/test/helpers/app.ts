import { createDb, type Db } from "@kr/db";
import { createLogger, type Logger } from "@kr/logger";
import type { ObjectStorage } from "@kr/storage";
import type { FastifyInstance } from "fastify";
import { DummyDriver, Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler } from "kysely";
import { inject } from "vitest";
import { buildApp } from "../../src/app.js";
import type { ApiConfig } from "../../src/config.js";
import { fixedClock, staticFlags } from "../../src/platform/flags.js";
import { MODULES } from "../../src/modules/index.js";
import type { ApiModule, Clock, FeatureFlag, FeatureFlags, ModuleDeps } from "../../src/platform/module.js";
import { testConfig } from "./config.js";
import { probeModule } from "./probe.js";
import { createMemoryStorage, type MemoryStorage } from "./memory-storage.js";

export const TEST_NOW = "2026-03-02T01:00:00.000Z";
/** A Kysely that compiles but never connects: for unit tests of routing and error handling. */
export function dummyDb(): Db {
  return new Kysely({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => new DummyDriver(),
      createIntrospector: (db) => new PostgresIntrospector(db),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  });
}

export interface TestAppOptions {
  readonly db?: Db;
  readonly clock?: Clock;
  readonly flags?: FeatureFlags | Partial<Record<FeatureFlag, boolean>>;
  readonly storage?: ObjectStorage;
  readonly config?: ApiConfig;
  readonly extraModules?: readonly ApiModule[];
  /** Replace MODULES (platform tests that define contract routes themselves must not collide with real modules). */
  readonly modules?: readonly ApiModule[];
}

export interface TestApp {
  readonly app: FastifyInstance;
  readonly deps: ModuleDeps;
  readonly db: Db;
  readonly clock: ReturnType<typeof fixedClock>;
  readonly storage: MemoryStorage;
  logLines(): Record<string, unknown>[];
  close(): Promise<void>;
}

export async function createTestApp(opts: TestAppOptions = {}): Promise<TestApp> {
  const lines: string[] = [];
  const log: Logger = createLogger({
    service: "api-test",
    env: "test",
    level: "debug",
    destination: { write: (m: string) => void lines.push(m) },
  });
  const ownsDb = opts.db === undefined;
  const db = opts.db ?? createDb({ connectionString: inject("databaseUrl"), applicationName: "kr-api-test" });
  const clock = fixedClock(TEST_NOW);
  const storage = createMemoryStorage();
  const flags = opts.flags && "isEnabled" in opts.flags ? opts.flags : staticFlags(opts.flags);
  const deps: ModuleDeps = {
    db,
    config: opts.config ?? testConfig(),
    clock: opts.clock ?? clock,
    storage: opts.storage ?? storage,
    flags,
    log,
  };
  const app = await buildApp(deps, {
    modules: [...(opts.modules ?? MODULES), probeModule, ...(opts.extraModules ?? [])],
  });
  await app.ready();
  return {
    app,
    deps,
    db,
    clock,
    storage,
    logLines: () => lines.map((l) => JSON.parse(l) as Record<string, unknown>),
    close: async () => {
      await app.close();
      if (ownsDb) await db.destroy();
    },
  };
}
