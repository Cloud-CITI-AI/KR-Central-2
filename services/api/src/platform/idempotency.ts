/**
 * Idempotent POSTs (API-5, DATA_MODEL `idempotency_keys`): with an `Idempotency-Key`, the first request runs and its
 * response is stored in the SAME transaction as the change; a repeat with the same request returns the stored response,
 * and the same key with a different request is 409. A failed request stores nothing, so it can be retried. Keys are
 * scoped per user and expire after 24 hours.
 */
import { createHash } from "node:crypto";
import type { Database, Db } from "@kr/db";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Transaction } from "kysely";
import { BadRequestError, ConflictError } from "./errors.js";
import type { Clock } from "./module.js";

export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60_000;
const KEY_FORMAT = /^[\x21-\x7E]{8,128}$/;

export interface IdempotentResponse<T> {
  readonly status: number;
  readonly body: T;
}

export interface IdempotencyOptions {
  readonly request: Pick<FastifyRequest, "headers" | "method" | "url">;
  readonly userId: string;
  readonly operationId: string;
  /** The validated request body (hashed with the method and URL to detect key reuse). */
  readonly body: unknown;
  readonly clock: Clock;
}

/** JSON with object keys sorted, so equal requests hash equally whatever the client's key order. */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value).filter(([, v]) => v !== undefined);
    return `{${entries
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`)
      .join(",")}}`;
  }
  return value === undefined ? "null" : JSON.stringify(value);
}

export function requestHash(o: Pick<IdempotencyOptions, "request" | "operationId" | "body">): Buffer {
  return createHash("sha256")
    .update(`${o.operationId}\n${o.request.method}\n${o.request.url}\n${stableStringify(o.body)}`)
    .digest();
}

function readKey(headers: FastifyRequest["headers"]): string | undefined {
  const raw = headers["idempotency-key"];
  if (raw === undefined) return undefined;
  if (typeof raw !== "string" || !KEY_FORMAT.test(raw)) {
    throw new BadRequestError({ detail: "Idempotency-Key must be 8 to 128 printable characters." });
  }
  return raw;
}

/** Run `run` once per (user, key); `run` receives the transaction to do its writes (and audit) in. */
export async function withIdempotency<T>(
  db: Db,
  o: IdempotencyOptions,
  run: (trx: Transaction<Database>) => Promise<IdempotentResponse<T>>,
): Promise<IdempotentResponse<T> & { readonly replayed: boolean }> {
  const key = readKey(o.request.headers);
  if (key === undefined) return { ...(await db.transaction().execute(run)), replayed: false };
  const hash = requestHash(o);
  const now = o.clock.now();
  return db.transaction().execute(async (trx) => {
    await trx
      .deleteFrom("idempotency_keys")
      .where("user_id", "=", o.userId)
      .where("key", "=", key)
      .where("created_at", "<", new Date(now.getTime() - IDEMPOTENCY_TTL_MS))
      .execute();
    const claimed = await trx
      .insertInto("idempotency_keys")
      .values({ user_id: o.userId, key, operation_id: o.operationId, request_hash: hash, created_at: now })
      .onConflict((oc) => oc.columns(["user_id", "key"]).doNothing())
      .returning("key")
      .executeTakeFirst();
    if (claimed) {
      const result = await run(trx);
      await trx
        .updateTable("idempotency_keys")
        .set({ response_status: result.status, response_body: JSON.stringify(result.body) })
        .where("user_id", "=", o.userId)
        .where("key", "=", key)
        .execute();
      return { ...result, replayed: false };
    }
    const stored = await trx
      .selectFrom("idempotency_keys")
      .selectAll()
      .where("user_id", "=", o.userId)
      .where("key", "=", key)
      .executeTakeFirstOrThrow();
    if (stored.operation_id !== o.operationId || !stored.request_hash.equals(hash) || stored.response_status === null) {
      throw new ConflictError({ detail: "This Idempotency-Key was already used for a different request." });
    }
    return { status: stored.response_status, body: stored.response_body as T, replayed: true };
  });
}

/** Send an idempotent result: status, body, and `Idempotent-Replayed: true` on a replay. */
export function sendIdempotent<T>(
  reply: FastifyReply,
  result: IdempotentResponse<T> & { replayed: boolean },
): FastifyReply {
  if (result.replayed) void reply.header("idempotent-replayed", "true");
  return reply.code(result.status).send(result.body);
}
