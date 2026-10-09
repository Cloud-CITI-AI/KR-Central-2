# db-connections-saturated

Alert: [db-connections-saturated](../observability/alerts.md#db-connections-saturated) (page). Objective SLO-1. Fires when
over 90 % of a pool's connections stay in use for 5 minutes, or when requests have waited for a connection for 2 minutes.
Requests then queue and time out, which counts against availability.

## Symptoms

- Latency rises across all routes and 5xx follow; `db.client.connection.pending_requests` above zero.
- The API pool is `DATABASE_POOL_MAX` (10); the worker has its own pool; the database has a server-wide connection limit.

## Dashboards

6 Database (pool usage, pending requests, query duration p95), then 1 Service overview.

## Diagnose (read-only)

1. **Who holds connections** (read-only session, [README](README.md#a-read-only-sql-session)):

   ```sql
   SELECT application_name, state, count(*) AS n, max(now() - state_change) AS longest
   FROM pg_stat_activity WHERE datname = current_database()
   GROUP BY application_name, state ORDER BY n DESC;
   SHOW max_connections;
   ```

   `kr-api`, `kr-worker`, `kr-ops-migrate` are ours. Many `idle in transaction` or one long `active` row is the
   culprit. The app role is stopped at 15 s a statement and 30 s idle in a transaction, so a row older than that is
   not the app role's.

2. **Who blocks whom:**

   ```sql
   SELECT a.pid, a.application_name, a.state, now() - a.query_start AS running, pg_blocking_pids(a.pid) AS blocked_by
   FROM pg_stat_activity a WHERE a.datname = current_database() AND cardinality(pg_blocking_pids(a.pid)) > 0;
   ```

3. **A deploy overlap.** During a deploy the old and new deployments both hold pools for a short time. A spike that
   ends within minutes of a deploy marker needs no action; one that does not is a leak in the release.
4. **A migration.** `migrate` takes an advisory lock and sets `lock_timeout` to 5 s, so a stuck migration shows as
   `kr-ops-migrate` rows: see [migrate-failed](migrate-failed.md).
5. **Load.** Compare request rate with the SLO scale (50 concurrent users). A runaway client or a retry loop shows as one
   route with a huge request count on dashboard 2 (and 429s once a limit bites).

## Mitigate

1. **Release suspected:** roll back ([deploy-and-rollback](deploy-and-rollback.md)).
2. **A stuck query.** Confirm before running: the `pid` is a `kr-api` or `kr-worker` row from step 1, it has run for
   minutes, and a second person agrees in production. `SELECT pg_cancel_backend(<pid>);`. Use
   `pg_terminate_backend` only if the cancel did not release it, and record the pid and time.
3. **Leaked connections:** redeploy the leaking service from the dashboard (this drops its pool); expect a few seconds of
   errors on `api`.
4. **A sustained, honest need:** raise `DATABASE_POOL_MAX` only if `max_connections` has headroom for it across `api`,
   `worker` and a deploy overlap. That is a variable change plus a note in the operations log; plan the permanent value
   through a pull request to `docs/deploy/railway.md`.

## Escalate

Saturation continuing after a restart, or the database itself near its limits (disk, memory): incident
([incident-response](incident-response.md)), severity 2, and look at the Postgres plan size with KR.
