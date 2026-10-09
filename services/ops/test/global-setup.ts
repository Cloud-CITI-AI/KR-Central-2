import { bootstrapDatabase, createPool } from "@kr/db";
import { TEST_APP_PASSWORD, TEST_MIGRATOR_PASSWORD, startTestDatabase, type TestDatabase } from "@kr/db/testing";
import type { TestProject } from "vitest/node";
import { BARE_TEMPLATE } from "./constants.js";

let db: TestDatabase | undefined;

/**
 * One real Postgres 17 per run (Testcontainers, or TEST_DATABASE_ADMIN_URL when Docker is unavailable). Besides the
 * migrated database the other packages get, it prepares a bootstrapped but UNmigrated template: the migrate tests
 * need databases with nothing applied, and cloning one is much faster than bootstrapping each (and does not race on the
 * cluster-wide roles).
 */
export async function setup(project: TestProject): Promise<void> {
  db = await startTestDatabase();
  const admin = createPool({ connectionString: db.superuserUrl, maxConnections: 1 });
  try {
    await admin.query(`CREATE DATABASE ${BARE_TEMPLATE}`);
  } finally {
    await admin.end();
  }
  const bareUrl = new URL(db.superuserUrl);
  bareUrl.pathname = `/${BARE_TEMPLATE}`;
  await bootstrapDatabase({
    superuserUrl: bareUrl.toString(),
    migratorPassword: TEST_MIGRATOR_PASSWORD,
    appPassword: TEST_APP_PASSWORD,
  });
  project.provide("databaseUrl", db.appUrl);
  project.provide("migratorDatabaseUrl", db.migratorUrl);
  project.provide("superuserDatabaseUrl", db.superuserUrl);
}

export async function teardown(): Promise<void> {
  await db?.stop();
}

declare module "vitest" {
  export interface ProvidedContext {
    databaseUrl: string;
    migratorDatabaseUrl: string;
    superuserDatabaseUrl: string;
  }
}
