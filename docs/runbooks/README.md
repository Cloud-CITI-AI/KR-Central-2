# Runbooks

One runbook per alert in [observability/alerts.md](../observability/alerts.md), plus the procedures an operator needs
that no alert points at. Start from the alert name; if you were paged, open the matching runbook first and the
[on-call checklist](../operations/README.md) second. Objectives are in [slo.md](../slo.md), dashboards in
[observability/dashboards.md](../observability/dashboards.md).

## Alert runbooks

| Alert                    | Severity | Objective | Runbook                                                 |
| ------------------------ | -------- | --------- | ------------------------------------------------------- |
| api-availability         | page     | SLO-1     | [api-availability](api-availability.md)                 |
| api-latency              | ticket   | SLO-2/3   | [api-latency](api-latency.md)                           |
| worker-queue-backlog     | page     | SLO-4/5   | [worker-queue-backlog](worker-queue-backlog.md)         |
| operation-failures       | ticket   | SLO-4     | [operation-failures](operation-failures.md)             |
| db-connections-saturated | page     | SLO-1     | [db-connections-saturated](db-connections-saturated.md) |

## How every runbook is laid out

Symptoms (what users and the alert show), Dashboards (the numbered dashboards of `dashboards.md`), Diagnose
(read-only), Mitigate (the smallest change that stops the harm), Escalate (when to stop and open an incident).

## Ground rules

1. **Know the environment.** Every command names `staging` or `production`. If you are not sure which one you are in,
   stop. Reproduce in staging first when you can.
2. **Read before you write.** Diagnose steps never change anything. A step that changes state sits in a block headed
   **Confirm before running**: the conditions that must be true, a read-only check that shows exactly what the command
   will touch, then the command. For production a second person reads the check output before the command runs
   (post it in the incident thread). Never paste a destructive command you have not read.
3. **Nobody and nothing deploys by hand.** Deploys, rollbacks and settings changes go through `deploy.yml` and pull
   requests ([deploy-and-rollback](deploy-and-rollback.md)). Do not run the `railway` CLI to deploy, and do not edit
   service settings in the Railway dashboard: the next deploy reports it as drift. Restarting or redeploying the
   current image from the dashboard is allowed where a runbook says so.
4. **No personal data in tickets, chat or logs you write.** Use job numbers and ids, never client names, addresses,
   emails or file names. Log lines carry request ids and pseudonyms only; keep it that way.
5. **Record it.** Every state change and every page goes in the KR operations log with time (Perth, UTC+8 and UTC),
   who, what, and the evidence (see [operations/README.md](../operations/README.md)).

## Where to look

| What                  | Where                                                                                                                  |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Service logs          | Railway dashboard, the service, Logs. JSON lines with `event`, `level`, `requestId`; search for the event name in text |
| Deploys and rollbacks | GitHub Actions, workflows `release` and `deploy` (a failed step names the service and why)                             |
| Is the site up        | `node infra/railway/scripts/smoke.mjs --base-url https://<web domain>` (GET requests only; safe in production)         |
| Metrics and traces    | The approved OTLP backend, once there is one (ADR-0009). Until then logs, the smoke script and SQL (slo.md "interim")  |
| Database              | A read-only SQL session, below                                                                                         |
| Buckets               | Railway dashboard, the bucket; any S3 client with that bucket's keys from the password manager                         |

Until KR approves a metrics backend, "the dashboard" in a runbook means: the Railway service metrics and logs plus the
SQL here. Say so in the incident note; it is a known gap (slo.md, "Status and dependencies").

## A read-only SQL session

Sealed Railway variables cannot be read back, so build the connection from the password manager, not from Railway.

1. In the Postgres service, enable the TCP proxy for this session only and note the host and port.
2. From a workstation with PostgreSQL 17 client tools, connect as `tracker_app` (never the superuser, never
   `tracker_migrator`, for diagnosis): `psql "postgres://tracker_app:<password>@<proxy host>:<port>/<db>?sslmode=require"`.
3. First statement: `SET default_transaction_read_only = on;` and then `SELECT current_database(), now();` to confirm
   where you are. Tables are in schema `tracker` (the examples write it out).
4. When finished, `\q`, then disable the TCP proxy and write the session in the operations log.

The Railway Postgres "Data" tab is a break-glass fallback for reads only: it connects as the superuser.
Roles and password handling are in [database](database.md).
