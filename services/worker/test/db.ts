import { randomUUID } from "node:crypto";
import { createDb, enqueueOperation, type Db, type OperationRow, type OperationTypeValue } from "@kr/db";
import { inject } from "vitest";

/** A connection as the least-privilege app role (what the worker uses in production). */
export function openDb(): Db {
  return createDb({ connectionString: inject("databaseUrl"), maxConnections: 8, applicationName: "kr-worker-test" });
}

export async function insertJob(db: Db): Promise<string> {
  const row = await db
    .insertInto("jobs")
    .values({ job_number: `T-${randomUUID().slice(0, 8)}`, address: "1 Test Street" })
    .returning("id")
    .executeTakeFirstOrThrow();
  return row.id;
}

export async function enqueue(
  db: Db,
  jobId: string,
  type: OperationTypeValue,
  payload: Record<string, unknown> = {},
  maxAttempts?: number,
): Promise<OperationRow> {
  return enqueueOperation(db, { jobId, type, payload, createdBy: null, ...(maxAttempts ? { maxAttempts } : {}) });
}

export async function operation(db: Db, id: string): Promise<OperationRow> {
  return db.selectFrom("operations").selectAll().where("id", "=", id).executeTakeFirstOrThrow();
}

/** Polls `read` until `done` accepts it (or 10 s pass). */
export async function until<T>(read: () => Promise<T>, done: (value: T) => boolean, timeoutMs = 10_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (done(value) || Date.now() > deadline) return value;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

export async function insertUser(db: Db): Promise<string> {
  const row = await db
    .insertInto("users")
    .values({
      entra_tenant_id: randomUUID(),
      entra_object_id: randomUUID(),
      display_name: "Test User",
      is_guest: false,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return row.id;
}
