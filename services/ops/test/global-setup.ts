import type { TestProject } from "vitest/node";
import { startTestDatabase, type TestDatabase } from "@kr/db/testing";

let db: TestDatabase | undefined;

/** One real Postgres 17 per run (Testcontainers, or TEST_DATABASE_ADMIN_URL when Docker is unavailable). */
export async function setup(project: TestProject): Promise<void> {
  db = await startTestDatabase();
  project.provide("databaseUrl", db.appUrl);
  project.provide("migratorDatabaseUrl", db.migratorUrl);
}

export async function teardown(): Promise<void> {
  await db?.stop();
}

declare module "vitest" {
  export interface ProvidedContext {
    databaseUrl: string;
    migratorDatabaseUrl: string;
  }
}
