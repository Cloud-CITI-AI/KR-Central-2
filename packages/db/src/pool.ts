/**
 * Connection pool + Kysely instance. Services call createDb() once at startup with their validated config.
 */
import { Kysely, PostgresDialect } from "kysely";
import pg from "pg";
import type { Database } from "./schema.js";

// DATE stays a 'yyyy-mm-dd' string: no timezone shifting of business dates.
pg.types.setTypeParser(pg.types.builtins.DATE, (v: string) => v);
// bigint stays a string (audit ids, file sizes) — no silent precision loss.
pg.types.setTypeParser(pg.types.builtins.INT8, (v: string) => v);

export interface DbOptions {
  readonly connectionString: string;
  readonly maxConnections?: number;
  /** application_name shown in pg_stat_activity, e.g. "kr-api". */
  readonly applicationName?: string;
  readonly statementTimeoutMs?: number;
  readonly ssl?: boolean;
}

export type Db = Kysely<Database>;

export function createPool(opts: DbOptions): pg.Pool {
  return new pg.Pool({
    connectionString: opts.connectionString,
    max: opts.maxConnections ?? 10,
    application_name: opts.applicationName ?? "kr-tracker",
    statement_timeout: opts.statementTimeoutMs ?? 15_000,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    options: "-c search_path=tracker,public",
    ...(opts.ssl ? { ssl: { rejectUnauthorized: true } } : {}),
  });
}

export function createDb(opts: DbOptions): Db {
  return new Kysely<Database>({ dialect: new PostgresDialect({ pool: createPool(opts) }) });
}
