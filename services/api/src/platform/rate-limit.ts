/**
 * Rate limits (PRODUCT_SPEC §14) on Postgres through rate-limiter-flexible, so every API replica shares the counters:
 * sign-in routes per client IP, then per user: writes, uploads and reads. Exceeding a limit is a 429 problem with
 * Retry-After. The client IP is Fastify's `request.ip`, which with `trustProxy = TRUST_PROXY_HOPS` is the address the
 * web BFF forwarded in X-Forwarded-For, not the BFF's own address (so one noisy client cannot exhaust everyone's bucket).
 */
import { getRoute, type OperationId } from "@kr/contracts";
import type { Db } from "@kr/db";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { CompiledQuery } from "kysely";
import { RateLimiterPostgres, RateLimiterRes } from "rate-limiter-flexible";
import type { ApiConfig } from "../config.js";
import { TooManyRequestsError } from "./errors.js";
import { isPublicRoute } from "./session-auth.js";

export type LimitName = "signIn" | "writes" | "uploads" | "reads";
const WINDOW_SECONDS = 60;
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

interface Limiter {
  consume(key: string): Promise<void>;
}

/** The slice of a pg client that RateLimiterPostgres uses, backed by the shared Kysely pool. */
function pgClient(db: Db) {
  return {
    async query(q: { text: string; values?: unknown[] }) {
      const res = await db.executeQuery(CompiledQuery.raw(q.text, q.values ?? []));
      return { rows: res.rows, rowCount: Number(res.numAffectedRows ?? res.rows.length) };
    },
  };
}

function limiter(db: Db, name: LimitName, points: number): Limiter {
  const rl = new RateLimiterPostgres({
    storeClient: pgClient(db),
    storeType: "pool",
    tableName: "rate_limits",
    tableCreated: true,
    keyPrefix: name,
    points,
    duration: WINDOW_SECONDS,
  });
  return {
    async consume(key) {
      try {
        await rl.consume(key);
      } catch (err) {
        if (err instanceof RateLimiterRes) throw new TooManyRequestsError(err.msBeforeNext / 1000);
        throw err;
      }
    },
  };
}

export type RateLimiters = Readonly<Record<LimitName, Limiter>>;

export function createRateLimiters(
  db: Db,
  config: Pick<
    ApiConfig,
    | "RATE_LIMIT_SIGNIN_PER_MINUTE_PER_IP"
    | "RATE_LIMIT_WRITES_PER_MINUTE"
    | "RATE_LIMIT_UPLOADS_PER_MINUTE"
    | "RATE_LIMIT_READS_PER_MINUTE"
  >,
): RateLimiters {
  return {
    signIn: limiter(db, "signIn", config.RATE_LIMIT_SIGNIN_PER_MINUTE_PER_IP),
    writes: limiter(db, "writes", config.RATE_LIMIT_WRITES_PER_MINUTE),
    uploads: limiter(db, "uploads", config.RATE_LIMIT_UPLOADS_PER_MINUTE),
    reads: limiter(db, "reads", config.RATE_LIMIT_READS_PER_MINUTE),
  };
}

/** Which bucket (and key) a request is charged to; null = exempt (health probes, other public routes). */
export function limitFor(
  request: Pick<FastifyRequest, "method" | "routeOptions" | "auth" | "ip">,
): { name: LimitName; key: string } | null {
  const operationId = request.routeOptions.config.operationId as OperationId | undefined;
  const def = operationId ? getRoute(operationId) : undefined;
  if (isPublicRoute(request)) return def?.tag === "auth" ? { name: "signIn", key: request.ip } : null;
  if (!request.auth) return null;
  const key = request.auth.user.id;
  if (def?.request?.multipart) return { name: "uploads", key };
  return { name: SAFE_METHODS.has(request.method) ? "reads" : "writes", key };
}

export function registerRateLimits(
  app: FastifyInstance,
  deps: { db: Db; config: Parameters<typeof createRateLimiters>[1] },
): void {
  const limiters = createRateLimiters(deps.db, deps.config);
  app.addHook("onRequest", async (request) => {
    const charge = limitFor(request);
    if (!charge) return;
    try {
      await limiters[charge.name].consume(charge.key);
    } catch (err) {
      if (err instanceof TooManyRequestsError)
        request.log.warn({ event: "rate_limited", limit: charge.name }, "Rate limit hit");
      throw err;
    }
  });
}
