import { createLogger } from "@kr/logger";
import { createPool, migrate } from "@kr/db";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import {
  createBareDatabase,
  opsConfig,
  pgDump17,
  startS3Mock,
  type S3Mock,
  type ThrowawayDatabase,
} from "../test/support.js";
import { startMigrateService, type MigrateService } from "./migrate-service.js";

const BUCKET = "tracker-backups-test";
const log = createLogger({ service: "test", env: "local", level: "error" });
const clock = { now: () => new Date("2026-10-09T07:01:02Z") };
const PRE_MIGRATE_KEY = "db/pre-migrate/20261009T070102Z-v1.2.3-test.dump";

let s3: S3Mock;
let pgDumpPath: string;
const databases: ThrowawayDatabase[] = [];
const services: MigrateService[] = [];

async function bareDatabase(): Promise<ThrowawayDatabase> {
  const db = await createBareDatabase(inject("superuserDatabaseUrl"));
  databases.push(db);
  return db;
}

async function listKeys(prefix: string): Promise<string[]> {
  const keys: string[] = [];
  for await (const entry of s3.storage.list(prefix)) keys.push(entry.key);
  return keys;
}

async function readObject(key: string): Promise<Buffer> {
  const object = await s3.storage.get(key);
  const chunks: Buffer[] = [];
  for await (const chunk of object.body as AsyncIterable<Buffer>) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function appliedVersions(url: string): Promise<string[]> {
  const pool = createPool({ connectionString: url, maxConnections: 1 });
  try {
    const table = await pool.query<{ present: boolean }>(
      "SELECT to_regclass('tracker.schema_migrations') IS NOT NULL AS present",
    );
    if (table.rows[0]?.present !== true) return [];
    return (
      await pool.query<{ version: string }>("SELECT version FROM tracker.schema_migrations ORDER BY version")
    ).rows.map((r) => r.version);
  } finally {
    await pool.end();
  }
}

async function start(
  db: ThrowawayDatabase,
  overrides: { PG_DUMP_PATH?: string; migrationsDir?: string; release?: string } = {},
) {
  const service = await startMigrateService({
    config: opsConfig(
      { MIGRATION_DATABASE_URL: db.migratorUrl, PG_DUMP_PATH: overrides.PG_DUMP_PATH ?? pgDumpPath },
      s3,
      BUCKET,
    ),
    log,
    storage: s3.storage,
    clock,
    ...(overrides.migrationsDir !== undefined && { migrationsDir: overrides.migrationsDir }),
  });
  services.push(service);
  return service;
}

const health = (service: MigrateService): Promise<Response> => fetch(`http://127.0.0.1:${service.port}/healthz`);

beforeAll(async () => {
  [s3, pgDumpPath] = await Promise.all([startS3Mock([BUCKET], BUCKET), pgDump17()]);
});

afterAll(async () => {
  await Promise.all(services.map((s) => s.close().catch(() => undefined)));
  await Promise.all(databases.map((d) => d.drop()));
  await s3.stop();
});

describe("migrate service against real Postgres 17 and an S3 bucket", () => {
  it("dumps the database BEFORE migrating a never-migrated database, then reports healthy", async () => {
    const db = await bareDatabase();
    const service = await start(db);
    const outcome = await service.done;

    expect(outcome.backupKey).toBe(PRE_MIGRATE_KEY);
    expect(outcome.applied).toEqual(["0001_initial_schema.sql"]);
    expect(await appliedVersions(db.migratorUrl)).toEqual(["0001"]);
    expect((await health(service)).status).toBe(200);

    // A pg_dump custom-format archive that holds the schema as it was before the migration: no tracker tables yet.
    const dump = await readObject(PRE_MIGRATE_KEY);
    expect(dump.subarray(0, 5).toString()).toBe("PGDMP");
    expect(dump.includes("audit_events")).toBe(false);
  });

  it("takes no dump when nothing is pending", async () => {
    const db = await bareDatabase();
    await migrate({ connectionString: db.migratorUrl });
    const before = await listKeys("db/");
    const service = await start(db);
    const outcome = await service.done;
    expect(outcome).toEqual({ pending: [], backupKey: undefined, applied: [] });
    expect(await listKeys("db/")).toEqual(before);
    expect((await health(service)).status).toBe(200);
  });
});
