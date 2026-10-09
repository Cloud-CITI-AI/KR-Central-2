/**
 * Test database helper (playbook BE-9: real Postgres, never a mocked client).
 * - CI and Docker hosts: one Testcontainers `postgres:17-alpine` per test run (same major as production).
 * - No Docker: set TEST_DATABASE_ADMIN_URL to a superuser URL of any local Postgres 17; a fresh database is
 *   created per run and dropped afterwards.
 * Either way the database is bootstrapped (roles) and migrated, and tests connect as the least-privilege app role.
 */
import { randomBytes } from "node:crypto";
import pg from "pg";
import { bootstrapDatabase } from "./bootstrap.js";
import { migrate } from "./migrate.js";

export const TEST_MIGRATOR_PASSWORD = "test-migrator-password-not-secret";
export const TEST_APP_PASSWORD = "test-app-password-not-secret";
export const POSTGRES_TEST_IMAGE = "postgres:17-alpine";

export interface TestDatabase {
  /** Connect as tracker_app (what services use). */
  readonly appUrl: string;
  /** Connect as tracker_migrator (DDL; use only for privilege tests). */
  readonly migratorUrl: string;
  readonly superuserUrl: string;
  stop(): Promise<void>;
}

function withCredentials(url: string, user: string, password: string, database?: string): string {
  const u = new URL(url);
  u.username = user;
  u.password = password;
  if (database) u.pathname = `/${database}`;
  return u.toString();
}

async function prepare(superuserUrl: string): Promise<{ appUrl: string; migratorUrl: string }> {
  await bootstrapDatabase({ superuserUrl, migratorPassword: TEST_MIGRATOR_PASSWORD, appPassword: TEST_APP_PASSWORD });
  const migratorUrl = withCredentials(superuserUrl, "tracker_migrator", TEST_MIGRATOR_PASSWORD);
  await migrate({ connectionString: migratorUrl });
  return { appUrl: withCredentials(superuserUrl, "tracker_app", TEST_APP_PASSWORD), migratorUrl };
}

// Test infrastructure may read the environment directly (exempted from BE-2 in eslint.config.mjs).
const adminUrlFromEnv = (): string | undefined => process.env.TEST_DATABASE_ADMIN_URL;

export async function startTestDatabase(): Promise<TestDatabase> {
  const adminUrl = adminUrlFromEnv();
  if (adminUrl) {
    const dbName = `tracker_test_${randomBytes(6).toString("hex")}`;
    const admin = new pg.Client({ connectionString: adminUrl });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${dbName}`);
    await admin.end();
    const superuserUrl = withCredentials(
      adminUrl,
      decodeURIComponent(new URL(adminUrl).username),
      decodeURIComponent(new URL(adminUrl).password),
      dbName,
    );
    const { appUrl, migratorUrl } = await prepare(superuserUrl);
    return {
      appUrl,
      migratorUrl,
      superuserUrl,
      async stop() {
        const c = new pg.Client({ connectionString: adminUrl });
        await c.connect();
        await c.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
        await c.end();
      },
    };
  }
  const { PostgreSqlContainer } = await import("@testcontainers/postgresql");
  const container = await new PostgreSqlContainer(POSTGRES_TEST_IMAGE).withDatabase("tracker").start();
  const superuserUrl = container.getConnectionUri();
  const { appUrl, migratorUrl } = await prepare(superuserUrl);
  return {
    appUrl,
    migratorUrl,
    superuserUrl,
    async stop() {
      await container.stop();
    },
  };
}
