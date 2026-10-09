/**
 * Turns a postgres:// URL into what the pg_dump child process and the migration runner need. pg_dump gets the password
 * through the environment (PGPASSWORD), never on its command line, where `ps` would show it to other processes.
 */

/** libpq environment for one connection. `ssl` mirrors DATABASE_SSL: verify the server against the system CAs. */
export function pgEnv(databaseUrl: string, ssl: boolean): Record<string, string> {
  const url = new URL(databaseUrl);
  const host = decodeURIComponent(url.hostname).replace(/^\[(.*)\]$/, "$1");
  const sslMode = ssl ? "verify-full" : (url.searchParams.get("sslmode") ?? "prefer");
  return {
    PGHOST: host,
    PGPORT: url.port === "" ? "5432" : url.port,
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: decodeURIComponent(url.pathname.replace(/^\//, "")),
    PGSSLMODE: sslMode,
    ...(sslMode === "verify-full" ? { PGSSLROOTCERT: "system" } : {}),
    PGCONNECT_TIMEOUT: "15",
    PGAPPNAME: "kr-ops",
  };
}

/** The migration runner takes only a connection string, so DATABASE_SSL becomes `sslmode=verify-full` in it. */
export function withSslMode(databaseUrl: string, ssl: boolean): string {
  if (!ssl) return databaseUrl;
  const url = new URL(databaseUrl);
  url.searchParams.set("sslmode", "verify-full");
  return url.toString();
}
