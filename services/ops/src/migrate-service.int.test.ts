import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLogger } from "@kr/logger";
import { createPool, MIGRATIONS_DIR, migrate } from "@kr/db";
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
let extraDir: string;
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

/** The shipped migrations plus one more file, in a temporary directory. */
async function migrationsWith(name: string, sql: string): Promise<string> {
  const dir = await mkdtemp(join(extraDir, "m-"));
  await cp(MIGRATIONS_DIR, dir, { recursive: true });
  await writeFile(join(dir, name), sql);
  return dir;
}

beforeAll(async () => {
  [s3, pgDumpPath, extraDir] = await Promise.all([
    startS3Mock([BUCKET], BUCKET),
    pgDump17(),
    mkdtemp(join(tmpdir(), "kr-ops-migrations-")),
  ]);
});

afterAll(async () => {
  await Promise.all(services.map((s) => s.close().catch(() => undefined)));
  await Promise.all(databases.map((d) => d.drop()));
  await s3.stop();
  await rm(extraDir, { recursive: true, force: true });
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

  it("answers 503 while the migration runs and 200 only after it finished", async () => {
    const db = await bareDatabase();
    const dir = await migrationsWith("0002_slow.sql", "SELECT pg_sleep(2);\n");
    const service = await start(db, { migrationsDir: dir });
    const during: number[] = [];
    while (service.status() === "migrating") {
      during.push((await health(service)).status);
      await new Promise((r) => setTimeout(r, 100));
    }
    await service.done;
    expect(during.length).toBeGreaterThan(3);
    expect(new Set(during)).toEqual(new Set([503]));
    expect((await health(service)).status).toBe(200);
  });

  it("dumps a populated database and applies only the new migration", async () => {
    const db = await bareDatabase();
    await migrate({ connectionString: db.migratorUrl });
    const dir = await migrationsWith(
      "0002_ops_probe.sql",
      "CREATE TABLE tracker.ops_probe (id integer PRIMARY KEY);\n",
    );
    const service = await start(db, { migrationsDir: dir });
    const outcome = await service.done;
    expect(outcome.pending).toEqual(["0002_ops_probe.sql"]);
    expect(outcome.applied).toEqual(["0002_ops_probe.sql"]);
    const dump = await readObject(outcome.backupKey ?? "missing");
    expect(dump.includes("audit_events")).toBe(true); // the existing schema is in the recovery point
    expect(dump.includes("ops_probe")).toBe(false); // the new table is not
    expect(await appliedVersions(db.migratorUrl)).toEqual(["0001", "0002"]);
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

  it("fails without ever answering 200 when a migration errors, leaving the dump as the recovery point", async () => {
    const db = await bareDatabase();
    await migrate({ connectionString: db.migratorUrl });
    const dir = await migrationsWith("0002_broken.sql", "CREATE TABLE tracker.no_such_schema_x.t (id int);\n");
    const service = await start(db, { migrationsDir: dir });
    await expect(service.done).rejects.toThrow(/0002_broken\.sql failed/);
    expect(service.status()).toBe("failed");
    expect((await health(service)).status).toBe(503);
    expect(await appliedVersions(db.migratorUrl)).toEqual(["0001"]);
    expect((await listKeys("db/pre-migrate/")).length).toBeGreaterThan(0);
  });

  it("changes nothing and never answers 200 when the dump fails", async () => {
    const db = await bareDatabase();
    const failing = join(extraDir, "pg_dump_fails");
    await writeFile(failing, '#!/bin/sh\necho "pg_dump: error: connection refused" >&2\nexit 1\n', { mode: 0o755 });
    const service = await start(db, { PG_DUMP_PATH: failing });
    await expect(service.done).rejects.toThrow(/pg_dump failed \(exit 1\)/);
    expect((await health(service)).status).toBe(503);
    expect(await appliedVersions(db.migratorUrl)).toEqual([]); // not even the migrations table was created
  });

  it("fails when the database cannot be reached", async () => {
    const db = await bareDatabase();
    const unreachable = db.migratorUrl.replace(/@([^:/]+):\d+\//, "@127.0.0.1:1/");
    const service = await start({ ...db, migratorUrl: unreachable });
    await expect(service.done).rejects.toThrow();
    expect(service.status()).toBe("failed");
  });
});
