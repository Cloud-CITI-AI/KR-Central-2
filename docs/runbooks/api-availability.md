# api-availability

Alert: [api-availability](../observability/alerts.md#api-availability) (page). Objective SLO-1: 99.5 % of requests
succeed over 30 days (error budget about 216 minutes a month). Pages on a fast burn (5xx above 7.2 % over 1 h and
5 min) or on `/readyz` failing for 3 minutes.

## Symptoms

- Users see the branded error page or "A change couldn't be saved"; sign-in loops; uploads fail.
- `https://<web domain>/api/readyz` is not 200, or 5xx dominate dashboard 1.
- It started at a deploy marker: treat the release as the suspect.

## Dashboards

1 Service overview (error ratio, readiness per instance), then 6 Database. Without a backend, use the `api` and
`web` service logs and `smoke.mjs`.

## Diagnose (read-only)

1. **Which layer.** `curl -s -o /dev/null -w '%{http_code}\n' https://<web domain>/api/healthz` (web liveness) and
   `.../api/readyz` (web, then API, then database and bucket). healthz 200 with readyz failing means API, database or
   bucket; healthz failing means `web`.
2. **Was there a deploy.** GitHub Actions, workflow `deploy`: did a run finish or roll back in the last hour? If the
   errors began with the deploy and `deploy.yml` did not roll back, go to Mitigate 1.
3. **Service state.** Railway dashboard: `api` deployment status, restart count (restart policy is on failure, 10
   retries, so a crash loop ends in a stopped service), memory. Logs: `request_failed` (status, error name and code),
   `startup_failed`, `unhandled_rejection`, `uncaught_exception`, `shutdown_timeout`.
4. **Database.** `postgres` service status and volume. Then the saturation query in
   [db-connections-saturated](db-connections-saturated.md); a pool full of waiting requests looks like an outage.
5. **Bucket.** Logs with `file_object_missing` show a missing object, not an outage. A failing `/readyz` with a
   healthy database points at the `files` bucket or its keys: check Railway's status page and whether the keys were
   rotated recently ([secrets-rotation](secrets-rotation.md)).
6. **Configuration.** `startup_failed` or `config_invalid` naming variables means a variable was changed or removed.

## Mitigate

1. **Release suspected:** roll back to the previous tag with `deploy.yml` ([deploy-and-rollback](deploy-and-rollback.md)).
   Migrations are expand-only, so the old images run on the new schema. Freeze further deploys (`DEPLOYS_FROZEN=true`).
2. **Crashed or stuck `api`:** Railway dashboard, `api`, redeploy the current deployment (same image, no change).
3. **Database or bucket down:** open a Railway support case with the time and service ids. Restarting Postgres from
   the dashboard is a last resort (it drops every connection): confirm first that nobody is running a restore or drill
   against that environment ([backup-and-restore](backup-and-restore.md)).
4. **A bad variable:** put it back to the value in the password manager and redeploy `api` (never print it).

## Escalate

Not recovered in 15 minutes, any sign of data loss, or an unexplained crash after a rollback: open an incident
([incident-response](incident-response.md)) at severity 1 or 2. When the month's budget falls under 50 % follow the
error budget policy in `slo.md`.
