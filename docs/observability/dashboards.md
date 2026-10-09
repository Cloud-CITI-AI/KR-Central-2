# Dashboards

Backend-neutral dashboard definitions for the signals in [alerts.md](alerts.md) and the objectives in
[../slo.md](../slo.md). Build them in whichever backend KR approves (ADR-0009). Every panel uses service, route, method,
status and the closed label sets of `@kr/telemetry`; none shows a user, email, client or file name. Show deploy markers
on every time series and default the range to 24 h.

## 1. Service overview (RED)

Audience: everyone on call. The first dashboard to open for any page.

- Request rate by service (`kr-api`, `kr-worker`): `http.server.request.duration` count.
- Error ratio: 5xx over all requests, with the SLO-1 fast and slow burn thresholds drawn as lines.
- Latency: p50, p95, p99 of `http.server.request.duration`, reads and writes in separate panels, with the 300 ms,
  800 ms and 1 s budgets as lines.
- Availability this month and error budget remaining (SLO-1), as single numbers.
- Readiness: last `/readyz` result per API instance.

## 2. API routes

Audience: engineers investigating api-latency.

- Top routes by p95 and by request count (`http.route`, the matched route template).
- Status code breakdown per route (2xx, 4xx, 5xx); 429 (rate limited) and 412 (version conflict) highlighted.
- Slowest traces: link the panel to the trace search filtered by duration above 800 ms. Traces are sampled (default
  10 %), so absence of a trace does not mean absence of a request.

## 3. Worker and queue

Audience: engineers investigating worker-queue-backlog and operation-failures.

- `kr.operations.queue_depth` over time, per `type`.
- `kr.operations.queue_age` per `type`, with the 600 s line (the worker-queue-backlog threshold).
- `kr.operations.processed` rate split by `status` and by `type`.
- Failure ratio by `type` (the operation-failures condition).
- `kr.ai.stamp_reading` by `result` (read, disabled, refused, timeout, unparseable, error).
- `kr.operations.duration` p50, p95 and p99 per `type`, with the 120 s line (SLO-4).

## 4. Files and malware scanning

Audience: engineers investigating malware-detected, malware-scan-errors and clamav-down.

- `kr.files.scanned` by `result` (clean, infected, error), rate and totals.
- Scan error ratio with the 50 % and 5 % thresholds drawn.
- `clamav` service health and signature age (48 h line).
- Files that exhausted their scan retries (log events), as a count.

## 5. Security and auth

Audience: engineers investigating auth-failure-spike.

- `kr.auth.signins` by `result` per 5 min, and failures against the previous 24 h average.
- Authorisation denials and rate-limit rejections (security log events) per 15 min.
- Counts only: user identifiers appear in logs as pseudonyms and are never charted.

## 6. Database

Audience: engineers investigating db-connections-saturated and slow routes.

- Pool usage: `db.client.connection.count` by `db.client.connection.state` against `db.client.connection.max`.
- `db.client.connection.pending_requests` over time.
- Query duration p95 (`db.client.operation.duration`) by operation name; statements are parameterised and carry no
  values.

## 7. Delivery and backups

Audience: whoever approves a production release; the on-call engineer after a deploy.

- Deploy markers with the release version, and the smoke watch result for each deploy.
- Migrate service status per deploy and the age of the latest pre-migration dump.
- `kr.backup.runs` by `result` and hours since the last success (26 h line).
