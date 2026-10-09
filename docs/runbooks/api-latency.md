# api-latency

Alert: [api-latency](../observability/alerts.md#api-latency) (ticket). Objectives SLO-2 (reads p95 under 300 ms, p99
under 800 ms) and SLO-3 (writes p95 under 1 s). Uploads and downloads are excluded. Fires after 15 minutes over budget.

## Symptoms

- Pages feel slow, saves lag, the job list takes seconds, tracker refreshes time out.
- Dashboard 1 latency panels cross the 300 ms, 800 ms or 1 s lines. The 10-minute smoke watch after a deploy checks the
  same budgets and rolls back automatically.

## Dashboards

2 API routes (top routes by p95, status breakdown), 6 Database (pool, query duration p95), 3 Worker and queue.

## Diagnose (read-only)

1. **One route or all.** Dashboard 2 sorted by p95. All routes slow points at the database or CPU; one route points at
   a query or a recent change to it. `http.route` is the route template, never an id.
2. **After a deploy.** Compare with the deploy marker and the release's changes. A regression that began at a deploy
   is fixed by rollback, not tuning.
3. **Pool pressure.** `db.client.connection.pending_requests` above zero, or used connections near the maximum, is
   [db-connections-saturated](db-connections-saturated.md) in slow motion.
4. **Slow statements** (read-only session, [README](README.md#a-read-only-sql-session)):

   ```sql
   SELECT pid, now() - query_start AS running, state, wait_event_type, left(query, 120) AS query
   FROM pg_stat_activity
   WHERE datname = current_database() AND state <> 'idle' AND pid <> pg_backend_pid()
   ORDER BY running DESC LIMIT 10;
   ```

   Statements are parameterised; the text carries no values. The app role is stopped at 15 s per statement.

5. **Growth.** The dashboard and job list summaries are computed in the API (PRODUCT_SPEC 14: designed for 2,000 active
   jobs, 200 users, 50 concurrent). Compare `SELECT count(*) FROM tracker.jobs WHERE deleted_at IS NULL;` with that.
6. **Not latency.** 429 responses are rate limits (writes 120 a minute, reads 600 a minute per user), not slowness.

## Mitigate

1. Rollback if it began with a release ([deploy-and-rollback](deploy-and-rollback.md)).
2. A runaway statement from the list above can be cancelled by its owner role. Confirm before running: `pid` is one
   row you read in step 4, `running` is minutes not seconds, its `application_name` is `kr-api`, and a second person
   agrees in production. `SELECT pg_cancel_backend(<pid>);` Record the pid and time.
3. Machine size and the 1 replica setting are plan decisions for KR, made by pull request to
   `infra/railway/services/*.json` or in Railway's plan, not an incident-time dashboard edit.

## Escalate

Write the route, window, p95 and suspected cause in a ticket. A latency problem that burns the SLO-1 budget (timeouts
count as failures) becomes [api-availability](api-availability.md). If one query needs an index, that is a migration:
expand-only, through the normal release ([database-migrations](database-migrations.md)).
