/** Which migration files are not yet recorded in tracker.schema_migrations (the same table the runner in @kr/db writes). */
import { createPool, loadMigrations } from "@kr/db";

export interface PendingOptions {
  readonly connectionString: string;
  readonly ssl: boolean;
  /** Migrations directory; defaults to the one shipped in @kr/db. */
  readonly dir?: string;
}

export async function findPendingMigrations(opts: PendingOptions): Promise<string[]> {
  const files = await loadMigrations(opts.dir);
  const pool = createPool({
    connectionString: opts.connectionString,
    ssl: opts.ssl,
    maxConnections: 1,
    applicationName: "kr-ops-migrate",
  });
  try {
    // A database that was never migrated has no table: every file is pending.
    const table = await pool.query<{ present: boolean }>(
      "SELECT to_regclass('tracker.schema_migrations') IS NOT NULL AS present",
    );
    if (table.rows[0]?.present !== true) return files.map((f) => f.name);
    const applied = await pool.query<{ version: string }>("SELECT version FROM tracker.schema_migrations");
    const done = new Set(applied.rows.map((r) => r.version));
    return files.filter((f) => !done.has(f.version)).map((f) => f.name);
  } finally {
    await pool.end();
  }
}
