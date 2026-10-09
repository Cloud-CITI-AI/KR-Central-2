/**
 * Operations queue (ADR-0006): the `operations` table is both the user-visible status of async work and the worker
 * queue. API modules enqueue; the worker claims with FOR UPDATE SKIP LOCKED under a lease, then completes or fails.
 * Functions accept a Kysely instance or transaction so enqueueing can share the caller's transaction.
 */
import { sql, type Kysely, type Transaction } from "kysely";
import type { Database, OperationRow, OperationTypeValue } from "./schema.js";

type Executor = Kysely<Database> | Transaction<Database>;

export interface EnqueueInput {
  readonly jobId: string;
  readonly type: OperationTypeValue;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly createdBy: string | null;
  readonly maxAttempts?: number;
  readonly runAfter?: Date;
}

export async function enqueueOperation(db: Executor, input: EnqueueInput): Promise<OperationRow> {
  return db
    .insertInto("operations")
    .values({
      job_id: input.jobId,
      type: input.type,
      payload: JSON.stringify(input.payload),
      created_by: input.createdBy,
      ...(input.maxAttempts ? { max_attempts: input.maxAttempts } : {}),
      ...(input.runAfter ? { run_after: input.runAfter } : {}),
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}

/** Claim the next due operation (optionally of given types) for `workerId` with a lease of `leaseSeconds`. */
export async function claimNextOperation(
  db: Kysely<Database>,
  workerId: string,
  leaseSeconds: number,
  types?: readonly OperationTypeValue[],
): Promise<OperationRow | undefined> {
  const typeFilter = types && types.length > 0 ? sql`AND type = ANY(${sql.val(types)}::text[])` : sql``;
  const r = await sql<OperationRow>`
    UPDATE operations
       SET status = 'running',
           locked_by = ${workerId},
           locked_until = now() + make_interval(secs => ${leaseSeconds}),
           attempts = attempts + 1,
           started_at = coalesce(started_at, now())
     WHERE id = (
       SELECT id FROM operations
        WHERE status = 'queued' AND run_after <= now() ${typeFilter}
        ORDER BY run_after, created_at
        FOR UPDATE SKIP LOCKED
        LIMIT 1)
    RETURNING *`.execute(db);
  return r.rows[0];
}

/** Mark succeeded. Only the lease holder may complete (guards against a re-claimed operation). */
export async function completeOperation(db: Executor, id: string, workerId: string, result: unknown): Promise<boolean> {
  const r = await db
    .updateTable("operations")
    .set({
      status: "succeeded",
      result: JSON.stringify(result ?? null),
      completed_at: new Date(),
      locked_by: null,
      locked_until: null,
    })
    .where("id", "=", id)
    .where("locked_by", "=", workerId)
    .where("status", "=", "running")
    .executeTakeFirst();
  return r.numUpdatedRows > 0n;
}

/**
 * Record a failure. Retryable failures are re-queued with exponential back-off (2^attempts × 10 s, max 10 min)
 * until max_attempts; otherwise the operation is failed permanently with a user-facing message.
 */
export async function failOperation(
  db: Executor,
  id: string,
  workerId: string,
  error: { code: string; message: string; retryable: boolean },
): Promise<"requeued" | "failed" | "lost"> {
  const op = await db
    .selectFrom("operations")
    .select(["attempts", "max_attempts", "locked_by", "status"])
    .where("id", "=", id)
    .executeTakeFirst();
  if (op?.locked_by !== workerId || op.status !== "running") return "lost";
  const retry = error.retryable && op.attempts < op.max_attempts;
  const delaySeconds = Math.min(600, 10 * 2 ** op.attempts);
  await db
    .updateTable("operations")
    .set({
      status: retry ? "queued" : "failed",
      error_code: error.code.slice(0, 80),
      error_message: error.message.slice(0, 1000),
      locked_by: null,
      locked_until: null,
      ...(retry ? { run_after: new Date(Date.now() + delaySeconds * 1000) } : { completed_at: new Date() }),
    })
    .where("id", "=", id)
    .execute();
  return retry ? "requeued" : "failed";
}

/** Re-queue operations whose lease expired (worker crashed). Returns the number re-queued. */
export async function requeueExpiredLeases(db: Kysely<Database>): Promise<number> {
  const r = await sql`
    UPDATE operations
       SET status = CASE WHEN attempts >= max_attempts THEN 'failed' ELSE 'queued' END,
           error_code = CASE WHEN attempts >= max_attempts THEN 'lease_expired' ELSE error_code END,
           error_message = CASE WHEN attempts >= max_attempts THEN 'The task did not finish in time. Try again.' ELSE error_message END,
           completed_at = CASE WHEN attempts >= max_attempts THEN now() ELSE completed_at END,
           locked_by = NULL, locked_until = NULL
     WHERE status = 'running' AND locked_until < now()`.execute(db);
  return Number(r.numAffectedRows ?? 0n);
}
