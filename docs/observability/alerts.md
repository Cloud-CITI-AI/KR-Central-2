# Alert definitions

Backend-neutral rules for the objectives in [../slo.md](../slo.md). Signals are OpenTelemetry metric names or
structured log events (ADR-0009); translate each rule into the chosen backend's syntax. Every alert links the runbook
that answers it. Alerts never carry personal data: labels are route, method, status, service and the closed label sets
of `@kr/telemetry`.

Conventions:

- **page**: wake someone, work in progress for users. **ticket**: handle in business hours.
- "for" is how long the condition must hold before firing. Rates use 5-minute windows unless stated.
- Deploy markers from `deploy.yml` are shown on every dashboard; an alert that starts at a deploy points at rollback
  first (deploy runbook).
- Metrics with no `kr.` prefix come from the http and pg instrumentations. `http.route` is the matched route template
  (for example `/v1/jobs/:id`), set by the Fastify instrumentation inside `@kr/telemetry`; query strings never reach it.

| Alert                    | Severity | Runbook                                                             |
| ------------------------ | -------- | ------------------------------------------------------------------- |
| api-availability         | page     | [api-availability](../runbooks/api-availability.md)                 |
| api-latency              | ticket   | [api-latency](../runbooks/api-latency.md)                           |
| worker-queue-backlog     | page     | [worker-queue-backlog](../runbooks/worker-queue-backlog.md)         |
| operation-failures       | ticket   | [operation-failures](../runbooks/operation-failures.md)             |
| malware-detected         | page     | [malware-detected](../runbooks/malware-detected.md)                 |
| malware-scan-errors      | ticket   | [malware-scan-errors](../runbooks/malware-scan-errors.md)           |
| clamav-down              | page     | [clamav-down](../runbooks/clamav-down.md)                           |
| auth-failure-spike       | page     | [auth-failure-spike](../runbooks/auth-failure-spike.md)             |
| migrate-failed           | page     | [migrate-failed](../runbooks/migrate-failed.md)                     |
| backup-failed            | page     | [backup-failed](../runbooks/backup-failed.md)                       |
| db-connections-saturated | page     | [db-connections-saturated](../runbooks/db-connections-saturated.md) |

## api-availability

Objective: SLO-1. Runbook: [api-availability](../runbooks/api-availability.md).

- Signal: share of `http.server.request.duration` observations with `http.response.status_code` 5xx, excluding
  `/healthz` and `/readyz`; or `/readyz` failing on any API instance.
- Fast burn (page): error ratio above 7.2 % (14.4 times the 0.5 % budget) over both 1 h and 5 min.
- Slow burn (ticket): error ratio above 3 % (6 times budget) over both 6 h and 30 min.
- Also page when `/readyz` fails for 3 consecutive minutes (database or bucket unreachable).

## api-latency

Objective: SLO-2, SLO-3. Runbook: [api-latency](../runbooks/api-latency.md).

- Signal: `http.server.request.duration` percentiles, reads and writes separately, upload and download routes excluded.
- Fires when reads have p95 above 300 ms or p99 above 800 ms, or writes p95 above 1 s, for 15 min.
- The post-deploy smoke watch checks the same budgets every 30 s for 10 min and triggers the automatic rollback.

## worker-queue-backlog

Objective: SLO-4, SLO-5. Runbook: [worker-queue-backlog](../runbooks/worker-queue-backlog.md).

- Signal: `kr.operations.queue_depth` and the rate of `kr.operations.processed`.
- Fires when queue depth is above 0 and nothing was processed for 10 min (worker stalled or down), or when queue depth
  stays above 25 for 10 min (the queue is not draining; ADR-0009 "queue age over 10 min").

## operation-failures

Objective: SLO-4. Runbook: [operation-failures](../runbooks/operation-failures.md).

- Signal: `kr.operations.processed{status="failed"}` against all processed operations, per `type`.
- Fires when more than 20 % of operations of one type fail over 30 min with at least 5 operations, or when
  `kr.ai.stamp_reading{result}` is `error`, `timeout` or `unparseable` for more than 50 % of readings over 1 h
  (stamp reading falls back to the text rule, so this is a ticket, not a page).

## malware-detected

Objective: security. Runbook: [malware-detected](../runbooks/malware-detected.md).

- Signal: `kr.files.scanned{result="infected"}`.
- Fires on any increase (for 0 s). The file is already deleted and audited; the alert is for follow-up with the
  uploader and the job's staff.

## malware-scan-errors

Objective: SLO-5. Runbook: [malware-scan-errors](../runbooks/malware-scan-errors.md).

- Signal: `kr.files.scanned{result="error"}`, and the log event for a file whose scan retries
  (`SCAN_ERROR_MAX_RETRIES`, 3) are exhausted.
- Fires when any file exhausts its retries (it stays unopenable for users), or when scan errors exceed 5 % of scans
  over 1 h.

## clamav-down

Objective: SLO-5. Runbook: [clamav-down](../runbooks/clamav-down.md).

- Signal: `kr.files.scanned{result="error"}` ratio, the `clamav` service health check, and ClamAV signature age.
- Fires when more than 50 % of scans over 10 min end in `error`, when the `clamav` service is unhealthy for 5 min, or
  when the virus signatures are older than 48 h.

## auth-failure-spike

Objective: security (SC-D4). Runbook: [auth-failure-spike](../runbooks/auth-failure-spike.md).

- Signal: `kr.auth.signins{result="failure"}`; authorisation-denial and rate-limit (429) security log events.
- Fires when failures exceed 30 in 5 min and are more than 3 times the previous 24 h hourly average, or when
  authorisation denials double against the previous 24 h average with at least 20 in 15 min. The sign-in limit is 20
  per minute per client IP.

## migrate-failed

Objective: delivery. Runbook: [migrate-failed](../runbooks/migrate-failed.md).

- Signal: the `migrate` Railway service reports a failed or crashed deployment, or `deploy.yml` fails at the migrate
  step (the service is healthy only after a successful migration, ADR-0007/ADR-0008).
- Fires immediately on a failed migrate deployment. The previous version keeps serving; the pre-migration dump is the
  recovery point.

## backup-failed

Objective: SLO-6. Runbook: [backup-failed](../runbooks/backup-failed.md).

- Signal: `kr.backup.runs{result="failure"}`, or no `kr.backup.runs{result="success"}` within 26 h of the previous one
  (the `backup` cron runs daily at 18:15 UTC).
- Fires on any failure and on a missed run.

## db-connections-saturated

Objective: SLO-1. Runbook: [db-connections-saturated](../runbooks/db-connections-saturated.md).

- Signal: pg pool metrics `db.client.connection.count` by `db.client.connection.state` against
  `db.client.connection.max`, and `db.client.connection.pending_requests`.
- Fires when used connections stay above 90 % of the pool maximum for 5 min, or when requests are waiting for a
  connection for 2 min.
