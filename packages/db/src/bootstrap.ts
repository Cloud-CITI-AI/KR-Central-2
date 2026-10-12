/**
 * One-off database bootstrap (playbook DB-6, ADR-0007/0008): schema `tracker`, migration owner `tracker_migrator`
 * (DDL), least-privilege application role `tracker_app` (DML only) and the `tracker_backup` role the nightly pg_dump
 * uses (SELECT only, read-only sessions, so the backup cron never holds DDL credentials). Run by an operator with the Postgres
 * superuser — never by the app. Idempotent; re-running resets the passwords (90-day rotation, SE-4).
 */
import pg from "pg";

export interface BootstrapOptions {
  readonly superuserUrl: string;
  readonly migratorPassword: string;
  readonly appPassword: string;
  readonly backupPassword: string;
}

const STATEMENTS = [
  "ALTER ROLE tracker_app NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS",
  "ALTER ROLE tracker_migrator NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS",
  "ALTER ROLE tracker_backup NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS",
  "CREATE EXTENSION IF NOT EXISTS citext",
  "CREATE SCHEMA IF NOT EXISTS tracker AUTHORIZATION tracker_migrator",
  "REVOKE CREATE ON SCHEMA public FROM PUBLIC",
  "REVOKE CREATE ON SCHEMA tracker FROM PUBLIC",
  "GRANT USAGE ON SCHEMA tracker TO tracker_app",
  "GRANT USAGE ON SCHEMA public TO tracker_app, tracker_migrator, tracker_backup",
  "GRANT USAGE ON SCHEMA tracker TO tracker_backup",
  // pg_dump needs SELECT on every table and on every sequence (it reads their current values), nothing else.
  "GRANT SELECT ON ALL TABLES IN SCHEMA tracker TO tracker_backup",
  "GRANT SELECT ON ALL SEQUENCES IN SCHEMA tracker TO tracker_backup",
  "ALTER DEFAULT PRIVILEGES FOR ROLE tracker_migrator IN SCHEMA tracker GRANT SELECT ON TABLES TO tracker_backup",
  "ALTER DEFAULT PRIVILEGES FOR ROLE tracker_migrator IN SCHEMA tracker GRANT SELECT ON SEQUENCES TO tracker_backup",
  "ALTER DEFAULT PRIVILEGES FOR ROLE tracker_migrator IN SCHEMA tracker GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO tracker_app",
  "ALTER DEFAULT PRIVILEGES FOR ROLE tracker_migrator IN SCHEMA tracker GRANT USAGE, SELECT ON SEQUENCES TO tracker_app",
  "ALTER DEFAULT PRIVILEGES FOR ROLE tracker_migrator IN SCHEMA tracker GRANT EXECUTE ON FUNCTIONS TO tracker_app",
  "ALTER ROLE tracker_app SET search_path = tracker, public",
  "ALTER ROLE tracker_migrator SET search_path = tracker, public",
  "ALTER ROLE tracker_backup SET search_path = tracker, public",
  "ALTER ROLE tracker_backup SET default_transaction_read_only = on",
  "ALTER ROLE tracker_app SET statement_timeout = '15s'",
  "ALTER ROLE tracker_app SET idle_in_transaction_session_timeout = '30s'",
] as const;

async function upsertRole(
  client: pg.ClientBase,
  role: "tracker_app" | "tracker_migrator" | "tracker_backup",
  password: string,
): Promise<void> {
  const exists = await client.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [role]);
  const verb = exists.rowCount ? "ALTER" : "CREATE";
  // format(%I, %L) quotes server-side, so the password never becomes SQL text built in JS.
  const sql = await client.query<{ q: string }>(
    "SELECT format('%s ROLE %I LOGIN PASSWORD %L', $1::text, $2::text, $3::text) AS q",
    [verb, role, password],
  );
  const q = sql.rows[0]?.q;
  if (!q) throw new Error("could not build role statement");
  await client.query(q);
}

export async function bootstrapDatabase(opts: BootstrapOptions): Promise<void> {
  if (opts.migratorPassword.length < 16 || opts.appPassword.length < 16 || opts.backupPassword.length < 16) {
    throw new Error("Role passwords must be at least 16 characters");
  }
  const client = new pg.Client({ connectionString: opts.superuserUrl });
  await client.connect();
  try {
    await client.query("BEGIN");
    await upsertRole(client, "tracker_migrator", opts.migratorPassword);
    await upsertRole(client, "tracker_app", opts.appPassword);
    await upsertRole(client, "tracker_backup", opts.backupPassword);
    for (const s of STATEMENTS) await client.query(s);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    await client.end();
  }
}
