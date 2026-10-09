# Service level objectives

Owner: KR Surveys with the on-call engineer. Source: PRODUCT_SPEC §14, ADR-0009 (observability), ADR-0008 (delivery and
smoke watch). Alert rules that enforce these objectives are in [observability/alerts.md](observability/alerts.md); the
dashboards that show them are in [observability/dashboards.md](observability/dashboards.md).

Scope: the web app and the API (the worker is covered by the operations and scan objectives). Business hours (Perth,
UTC+8) matter most, but the objectives are measured around the clock so that an overnight failure is not hidden.

## Objectives

| ID    | Objective                | Target                                                     | Window         |
| ----- | ------------------------ | ---------------------------------------------------------- | -------------- |
| SLO-1 | Availability (web + API) | 99.5 % of requests succeed (not 5xx, not timed out)        | 30 days, month |
| SLO-2 | Read latency             | p95 < 300 ms and p99 < 800 ms for reads (GET, HEAD)        | 30 days        |
| SLO-3 | Write latency            | p95 < 1 s for writes (POST, PUT, PATCH, DELETE)            | 30 days        |
| SLO-4 | Operation completion     | 95 % of operations reach a final state in under 2 min      | 30 days        |
| SLO-5 | Scan backlog             | No file waits for its malware verdict for more than 10 min | 30 days        |
| SLO-6 | Backups                  | Every nightly backup run succeeds                          | 30 days        |

SLO-1 leaves an error budget of 0.5 %: about 3 h 36 min of full outage in a 30-day month (216 minutes).

## What counts

- Availability counts every request to the API through the web proxy, except `/healthz` and `/readyz` probes and
  client errors (4xx, including 401, 403, 404, 409, 412 and 429). A 5xx or a timeout is a failed request.
- Latency is the server-side duration of the request. Streamed file uploads and downloads are excluded from SLO-2 and
  SLO-3 (their time depends on file size and the client's network); the metadata calls around them are included.
- Operations (SLO-4) are the asynchronous tasks of ADR-0006: `conditions.extract`, `conformance.read`, `email.parse`
  and `file.scan`. The time runs from enqueue to a final state (`succeeded` or `failed`), so retries and queue wait
  count. Documents over the page cap that fail fast with a clear message still count as completed.
- Scan backlog (SLO-5) is the oldest queued scan. Uploads normally show "Scanning…" for a few seconds (ADR-0011).
- Planned maintenance is not excluded: deploys are zero-downtime and migrations are expand-only (ADR-0008), so a
  deploy that causes errors consumes budget like any other incident.

## How each objective is measured

| ID    | Signal (names in [alerts.md](observability/alerts.md))                                               | Interim source until a backend is approved                   |
| ----- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| SLO-1 | `http.server.request.duration` count by `http.response.status_code`                                  | Railway logs and the 10-minute post-deploy smoke watch       |
| SLO-2 | `http.server.request.duration` p95/p99 for GET and HEAD                                              | k6 smoke (`perf:check`) and the smoke watch latency probe    |
| SLO-3 | `http.server.request.duration` p95 for POST, PUT, PATCH, DELETE                                      | k6 smoke                                                     |
| SLO-4 | `kr.operations.processed{status}` rate, plus enqueue-to-final-state time from the `operations` table | A scheduled SQL query against the `operations` table         |
| SLO-5 | `kr.operations.queue_depth` and the `kr.operations.processed{type="file.scan"}` rate                 | The `operations` table (oldest queued `file.scan` row)       |
| SLO-6 | `kr.backup.runs{result}`                                                                             | The `backup` service's run log and the backup bucket listing |

The telemetry package exports no operation-duration histogram, so SLO-4 is computed from the `operations` table until a
duration metric is added (follow-up, not required for go-live).

## Error budget policy

- Budget remaining above 50 %: ship as normal.
- Budget remaining below 50 % or any fast-burn page (see alerts.md): finish the incident first; only fixes and
  reliability changes ship until the burn stops.
- Budget exhausted for the month: freeze feature releases (`DEPLOYS_FROZEN`, see the deploy runbook) except fixes
  agreed with KR; review at the next quarterly accepted-risk review.

## Status and dependencies

- Export is off until KR approves an OTLP backend (ADR-0009, recommendation: Grafana Cloud free tier). Until then
  only the smoke watch and logs verify these objectives, so SLO alerting is a go-live prerequisite and an open risk.
- No objective may rely on personal data: signals use route, method, status and the closed label sets of
  `@kr/telemetry` only.
- Review these targets after the first month of production traffic and whenever scale assumptions change (PRODUCT_SPEC
  §14: up to 2,000 active jobs, 200 users, 50 concurrent).
