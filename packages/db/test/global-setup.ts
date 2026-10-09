import type { TestProject } from "vitest/node";
import { startTestDatabase, type TestDatabase } from "../src/testing.js";

let db: TestDatabase | undefined;

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
