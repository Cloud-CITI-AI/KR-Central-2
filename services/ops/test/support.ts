/** Helpers shared by the integration tests: throwaway databases, an s3mock bucket, and a pg_dump 17 on any host. */
import { randomBytes } from "node:crypto";
import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseConfig } from "@kr/config";
import { createPool } from "@kr/db";
import { TEST_MIGRATOR_PASSWORD } from "@kr/db/testing";
import { createS3Storage, type S3Storage } from "@kr/storage";
import { GenericContainer, Wait, type StartedTestContainer } from "testcontainers";
import { BackupConfigSchema, MigrateConfigSchema, type BackupConfig, type MigrateConfig } from "../src/config.js";
import { BARE_TEMPLATE } from "./constants.js";

export interface ThrowawayDatabase {
  /** tracker_migrator on a bootstrapped database with NO migrations applied. */
  readonly migratorUrl: string;
  drop(): Promise<void>;
}

/** Clones the bootstrapped, unmigrated template (see global-setup.ts) under a random name. */
export async function createBareDatabase(superuserUrl: string): Promise<ThrowawayDatabase> {
  const name = `ops_t_${randomBytes(6).toString("hex")}`;
  const admin = createPool({ connectionString: superuserUrl, maxConnections: 1 });
  try {
    await admin.query(`CREATE DATABASE ${name} TEMPLATE ${BARE_TEMPLATE}`);
  } finally {
    await admin.end();
  }
  const migrator = new URL(superuserUrl);
  migrator.username = "tracker_migrator";
  migrator.password = TEST_MIGRATOR_PASSWORD;
  migrator.pathname = `/${name}`;
  return {
    migratorUrl: migrator.toString(),
    async drop() {
      const pool = createPool({ connectionString: superuserUrl, maxConnections: 1 });
      try {
        await pool.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      } finally {
        await pool.end();
      }
    },
  };
}

export interface S3Mock {
  readonly endpoint: string;
  /** A client for the bucket given to startS3Mock, to read back what the jobs wrote. */
  readonly storage: S3Storage;
  /** A client for any of the buckets created at start. */
  open(bucket: string): S3Storage;
  stop(): Promise<void>;
}

export const S3_TEST_CREDENTIALS = {
  accessKeyId: "test-key",
  secretAccessKey: "test-secret-0123456789",
  region: "us-east-1",
};

/** adobe/s3mock with the given buckets created at start. */
export async function startS3Mock(buckets: readonly string[], readBucket: string): Promise<S3Mock> {
  const container: StartedTestContainer = await new GenericContainer("adobe/s3mock:latest")
    .withExposedPorts(9090)
    .withEnvironment({ COM_ADOBE_TESTING_S3MOCK_STORE_INITIAL_BUCKETS: buckets.join(",") })
    .withWaitStrategy(Wait.forLogMessage(/Started S3MockApplication/))
    .start();
  const endpoint = `http://${container.getHost()}:${container.getMappedPort(9090)}`;
  const clients: S3Storage[] = [];
  const open = (bucket: string): S3Storage => {
    const client = createS3Storage({ ...S3_TEST_CREDENTIALS, endpoint, bucket, forcePathStyle: true });
    clients.push(client);
    return client;
  };
  return {
    endpoint,
    storage: open(readBucket),
    open,
    async stop() {
      for (const client of clients) client.close();
      await container.stop();
    },
  };
}

/**
 * A `pg_dump` executable for the tests. The host's client is usually older than Postgres 17 and refuses to dump it, so
 * this wrapper runs the real pg_dump 17 from the postgres:17-alpine image on the host network (the same major as
 * production and as the ops image). TEST_PG_DUMP_PATH points at a local pg_dump 17 instead, e.g. without Docker.
 */
export async function pgDump17(): Promise<string> {
  // Test infrastructure may read the environment directly (exempted from BE-2 in eslint.config.mjs).
  const local = process.env.TEST_PG_DUMP_PATH;
  if (local) return local;
  const dir = await mkdtemp(join(tmpdir(), "kr-ops-pgdump17-"));
  const path = join(dir, "pg_dump");
  await writeFile(
    path,
    '#!/bin/sh\nexec docker run --rm -i --network host -e PGHOST -e PGPORT -e PGUSER -e PGPASSWORD -e PGDATABASE -e PGSSLMODE -e PGCONNECT_TIMEOUT -e PGAPPNAME postgres:17-alpine pg_dump "$@"\n',
  );
  await chmod(path, 0o755);
  return path;
}

const commonEnv = (s3: S3Mock, bucket: string) => ({
  APP_ENV: "local",
  LOG_LEVEL: "error",
  BACKUP_S3_ENDPOINT: s3.endpoint,
  BACKUP_S3_BUCKET: bucket,
  BACKUP_S3_ACCESS_KEY_ID: S3_TEST_CREDENTIALS.accessKeyId,
  BACKUP_S3_SECRET_ACCESS_KEY: S3_TEST_CREDENTIALS.secretAccessKey,
  RELEASE_VERSION: "v1.2.3-test",
});

/** A parsed migrate-service config for tests: health endpoint on an ephemeral loopback port. */
export function migrateConfig(
  overrides: Partial<MigrateConfig> & { MIGRATION_DATABASE_URL: string; PG_DUMP_PATH: string },
  s3: S3Mock,
  bucket: string,
): MigrateConfig {
  const base = parseConfig(MigrateConfigSchema, {
    ...commonEnv(s3, bucket),
    MIGRATION_DATABASE_URL: overrides.MIGRATION_DATABASE_URL,
  });
  return { ...base, HOST: "127.0.0.1", PORT: 0, ...overrides };
}

/** A parsed backup-cron config for tests. The database is the read-only tracker_backup role, never the migrator. */
export function backupConfig(
  overrides: Partial<BackupConfig> & { BACKUP_DATABASE_URL: string; PG_DUMP_PATH: string },
  s3: S3Mock,
  bucket: string,
): BackupConfig {
  const base = parseConfig(BackupConfigSchema, {
    ...commonEnv(s3, bucket),
    BACKUP_DATABASE_URL: overrides.BACKUP_DATABASE_URL,
  });
  return { ...base, HOST: "127.0.0.1", PORT: 0, ...overrides };
}

/** An empty database (no roles' grants, no schema) on the cluster, to prove what a restore alone recreates. */
export async function createEmptyDatabase(
  superuserUrl: string,
): Promise<{ superuserUrl: string; drop(): Promise<void> }> {
  const name = `ops_restore_${randomBytes(6).toString("hex")}`;
  const admin = createPool({ connectionString: superuserUrl, maxConnections: 1 });
  try {
    await admin.query(`CREATE DATABASE ${name} TEMPLATE template0`);
  } finally {
    await admin.end();
  }
  const url = new URL(superuserUrl);
  url.pathname = `/${name}`;
  return {
    superuserUrl: url.toString(),
    async drop() {
      const pool = createPool({ connectionString: superuserUrl, maxConnections: 1 });
      try {
        await pool.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      } finally {
        await pool.end();
      }
    },
  };
}

/**
 * A `pg_restore` executable for the tests, the counterpart of pgDump17 (same image, host network). The archive is read
 * from stdin. TEST_PG_RESTORE_PATH points at a local pg_restore 17 instead.
 */
export async function pgRestore17(): Promise<string> {
  const local = process.env.TEST_PG_RESTORE_PATH;
  if (local) return local;
  const dir = await mkdtemp(join(tmpdir(), "kr-ops-pgrestore17-"));
  const path = join(dir, "pg_restore");
  await writeFile(
    path,
    '#!/bin/sh\nexec docker run --rm -i --network host -e PGHOST -e PGPORT -e PGUSER -e PGPASSWORD -e PGDATABASE -e PGSSLMODE -e PGCONNECT_TIMEOUT -e PGAPPNAME postgres:17-alpine pg_restore "$@"\n',
  );
  await chmod(path, 0o755);
  return path;
}
