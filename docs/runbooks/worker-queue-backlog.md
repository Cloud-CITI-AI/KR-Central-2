# worker-queue-backlog

Alert: [worker-queue-backlog](../observability/alerts.md#worker-queue-backlog) (page). Objectives SLO-4 (95 % of
operations finish in under 2 minutes) and SLO-5 (no file waits more than 10 minutes for a verdict). Fires when the
oldest due operation of any type has waited over 600 s for 5 minutes, or when work is queued and nothing was processed
for 10 minutes.

## Symptoms

- Uploads stay at "Scanning…", "Reading the conformed date…" or a conditions extraction never finishes.
- `kr.operations.queue_age` above 600 s, or `queue_depth` above zero with a flat `processed` rate (dashboard 3).

## Dashboards

3 Worker and queue, then 4 Files and malware scanning.

## Diagnose (read-only)

1. **Is the worker alive.** Railway: `worker` deployment status and restarts; logs for `worker_started`,
   `startup_failed`, `claim_failed`, `heartbeat_failed`, `lease_lost`, `leases_requeued`, `shutdown_started`.
2. **What is waiting** (read-only session, [README](README.md#a-read-only-sql-session)):

   ```sql
   SELECT type, status, count(*) AS n,
          min(created_at) AS oldest_created,
          count(*) FILTER (WHERE status = 'running' AND locked_until < now()) AS expired_leases
   FROM tracker.operations
   WHERE status IN ('queued', 'running')
   GROUP BY type, status ORDER BY type, status;
   ```

   `queue_age` only counts operations that are due (`run_after <= now()`); retries waiting out their back-off are not
   late. Expired leases are re-queued by the worker itself (lease 300 s).

3. **One type or all.** Only `file.scan` backed up: look at clamd, [clamav-down](clamav-down.md) (logs
   `clamd_unreachable`, `circuit_state_changed`). Only `conditions.extract` or `conformance.read`: one very large PDF
   holds a worker slot for up to 60 s, and the Anthropic call (when the flag is on) is bounded by
   `ANTHROPIC_TIMEOUT_MS`.
4. **Capacity.** The worker runs `WORKER_CONCURRENCY` (2) operations at a time and polls every second. A bulk upload of
   many files simply takes time: compare the queue's rate of drain with its depth before treating it as an outage.
5. **Database.** A saturated pool starves the poller too ([db-connections-saturated](db-connections-saturated.md)).

## Mitigate

1. **Stalled or crashed worker:** Railway dashboard, `worker`, redeploy the current deployment. In-flight work is safe:
   every handler is idempotent and an unfinished lease expires and is re-queued. The hourly sweep also first runs 60 s
   after start.
2. **Scanner is the cause:** fix `clamav` first; the queue then drains without help.
3. **Regression after a release:** roll back ([deploy-and-rollback](deploy-and-rollback.md)).
4. **Drain faster, only if CPU and memory have headroom:** raise `WORKER_CONCURRENCY` from 2 to 4 on `worker`, redeploy
   it, and put it back when the queue is empty. Record both changes. The parse threads are capped at 512 MB each.
5. Do not edit rows in `operations`. A poison operation stops by itself after `max_attempts` (3) and becomes `failed`.

## Escalate

Oldest operation older than 30 minutes, or the worker restarting repeatedly with no clear cause: open an incident
([incident-response](incident-response.md)), severity 2. Users can keep working: nothing in the tracker blocks on the
queue except opening a file that has not been scanned.
