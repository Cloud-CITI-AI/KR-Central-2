/** Queue statements the shared queue (@kr/db) does not have: lease heartbeat, lease release and the gauge reading. */
import type { Db } from "@kr/db";
import { sql } from "kysely";

/** Push the lease of a running operation out by `leaseSeconds`. False when this worker no longer holds it. */
export async function extendLease(db: Db, id: string, workerId: string, leaseSeconds: number): Promise<boolean> {
  const r = await db
    .updateTable("operations")
    .set({ locked_until: sql<Date>`now() + make_interval(secs => ${leaseSeconds})` })
    .where("id", "=", id)
    .where("locked_by", "=", workerId)
    .where("status", "=", "running")
    .executeTakeFirst();
  return r.numUpdatedRows > 0n;
}

/** Let the lease of an abandoned operation expire now, so any worker's next requeue sweep picks it up. */
export async function releaseLease(db: Db, id: string, workerId: string): Promise<void> {
  await db
    .updateTable("operations")
    .set({ locked_until: sql<Date>`now()` })
    .where("id", "=", id)
    .where("locked_by", "=", workerId)
    .where("status", "=", "running")
    .execute();
}

export interface QueueSnapshot {
  readonly depth: Record<string, number>;
  /** Seconds the oldest due operation of each type has waited. */
  readonly age: Record<string, number>;
}

/** Due queued operations per type: how many, and how long the oldest has waited (kr.operations.queue_*). */
export async function readQueue(db: Db): Promise<QueueSnapshot> {
  const rows = await db
    .selectFrom("operations")
    .select([
      "type",
      (eb) => eb.fn.countAll<string>().as("depth"),
      sql<string>`extract(epoch from now() - min(run_after))`.as("age"),
    ])
    .where("status", "=", "queued")
    .where("run_after", "<=", sql<Date>`now()`)
    .groupBy("type")
    .execute();
  return {
    depth: Object.fromEntries(rows.map((r) => [r.type, Number(r.depth)])),
    age: Object.fromEntries(rows.map((r) => [r.type, Math.max(0, Number(r.age))])),
  };
}
