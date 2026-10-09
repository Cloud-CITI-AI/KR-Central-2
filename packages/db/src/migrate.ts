/**
 * Forward-only SQL migration runner (playbook DB-3, §8.3). Run by the deploy job as tracker_migrator, before the
 * new code starts (the Railway `migrate` service, services/ops — ADR-0007). Applied files are immutable: a checksum mismatch aborts.
 *
 * - Files: migrations/NNNN_snake_name.sql, applied in lexical order, each in its own transaction.
 * - A file whose first line is "-- migrate:no-transaction" runs outside a transaction (CREATE INDEX CONCURRENTLY);
 *   such a file must contain exactly one statement.
 * - lock_timeout 5s and statement_timeout are set for every file; an advisory lock serialises concurrent runners.
 */
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import pg from "pg";

export const MIGRATIONS_DIR = fileURLToPath(new URL("../migrations/", import.meta.url));
const FILE_PATTERN = /^(\d{4})_[a-z0-9_]+\.sql$/;
const LOCK_KEY = 727_271_001; // arbitrary constant for pg_advisory_lock

export interface MigrationFile {
  readonly version: string;
  readonly name: string;
  readonly sql: string;
  readonly checksum: string;
  readonly transactional: boolean;
}

export interface MigrateOptions {
  readonly connectionString: string;
  readonly dir?: string;
  readonly lockTimeout?: string;
  readonly statementTimeout?: string;
  readonly log?: (message: string) => void;
}

export async function loadMigrations(dir: string = MIGRATIONS_DIR): Promise<MigrationFile[]> {
  const names = (await readdir(dir)).filter((n) => n.endsWith(".sql")).sort();
  const files: MigrationFile[] = [];
  for (const name of names) {
    const m = FILE_PATTERN.exec(name);
    if (!m?.[1]) throw new Error(`Bad migration file name: ${name} (expected NNNN_snake_name.sql)`);
    const sql = await readFile(new URL(name, `file://${dir.endsWith("/") ? dir : `${dir}/`}`), "utf8");
    files.push({
      version: m[1],
      name,
      sql,
      checksum: createHash("sha256").update(sql).digest("hex"),
      transactional: !sql.startsWith("-- migrate:no-transaction"),
    });
  }
  const versions = files.map((f) => f.version);
  if (new Set(versions).size !== versions.length) throw new Error("Duplicate migration version numbers");
  return files;
}

export async function migrate(opts: MigrateOptions): Promise<string[]> {
  const log = opts.log ?? (() => undefined);
  const files = await loadMigrations(opts.dir);
  const client = new pg.Client({ connectionString: opts.connectionString, options: "-c search_path=tracker,public" });
  await client.connect();
  const applied: string[] = [];
  try {
    await client.query("SELECT pg_advisory_lock($1)", [LOCK_KEY]);
    await client.query(`SET lock_timeout = '${opts.lockTimeout ?? "5s"}'`);
    await client.query(`SET statement_timeout = '${opts.statementTimeout ?? "120s"}'`);
    await client.query(
      `CREATE TABLE IF NOT EXISTS tracker.schema_migrations (
         version text PRIMARY KEY, name text NOT NULL, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`,
    );
    const done = new Map(
      (
        await client.query<{ version: string; checksum: string }>(
          "SELECT version, checksum FROM tracker.schema_migrations",
        )
      ).rows.map((r) => [r.version, r.checksum] as const),
    );
    for (const f of files) {
      const prior = done.get(f.version);
      if (prior !== undefined) {
        if (prior !== f.checksum)
          throw new Error(`Migration ${f.name} was modified after being applied (checksum mismatch)`);
        continue;
      }
      log(`applying ${f.name}`);
      if (f.transactional) {
        await client.query("BEGIN");
        try {
          await client.query(f.sql);
          await client.query("INSERT INTO tracker.schema_migrations (version, name, checksum) VALUES ($1, $2, $3)", [
            f.version,
            f.name,
            f.checksum,
          ]);
          await client.query("COMMIT");
        } catch (err) {
          await client.query("ROLLBACK");
          throw new Error(`Migration ${f.name} failed: ${(err as Error).message}`, { cause: err });
        }
      } else {
        await client.query(f.sql);
        await client.query("INSERT INTO tracker.schema_migrations (version, name, checksum) VALUES ($1, $2, $3)", [
          f.version,
          f.name,
          f.checksum,
        ]);
      }
      applied.push(f.name);
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [LOCK_KEY]).catch(() => undefined);
    await client.end();
  }
  return applied;
}
