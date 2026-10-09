# ADR-0009: Observability — structured logs, OpenTelemetry, health checks and SLOs

- Status: proposed
- Date: 2026-10-09
- Deciders: KR Surveys (Craig) — pending; drafted for review
- Drafted by: agent claude (orchestrator) for the launching human
- Related: docs/spec/PRODUCT_SPEC.md, ADR-0008, docs/slo.md

## Context

Playbook LG-1..5 and OB-1..6: JSON logs without personal data, OpenTelemetry traces with W3C context, RED metrics,
SLOs with burn-rate alerts linked to runbooks, deploy markers. Railway offers log viewing and basic CPU/memory metrics
only. Any external backend is a new external host (X7) needing approval.

## Decision

- Logs: pino JSON via `@kr/logger` only (redaction list, `service/env/requestId/traceId/event`), stdout → Railway logs.
  Security events (sign-in success/failure, authz denials, admin actions) logged with pseudonymised identifiers.
- Traces/metrics: OpenTelemetry Node SDK (`@kr/telemetry`) with HTTP, Fastify, pg and undici instrumentation, W3C trace
  context propagated web → api; RED metrics per route; queue depth/age and scan outcomes from the worker. Export via
  OTLP/HTTP only when `OTEL_EXPORTER_OTLP_ENDPOINT` is set — **backend to be chosen by KR** (recommendation: Grafana Cloud,
  free tier is enough; alternatives Honeycomb, Better Stack). Until approved, export is off and logs carry trace ids.
- Request id: web proxy generates `x-request-id` if absent; API echoes it in responses and problem bodies.
- Health: `/healthz` (liveness), `/readyz` (DB + bucket) for Railway health checks.
- SLOs (docs/slo.md): availability 99.5 %/30 days for web+API, p95 < 300 ms reads; operations completed < 2 min p95.
  Alerts: 5xx rate, auth failure spikes, authz denial spikes, queue age > 10 min, infected file detected, ClamAV
  signatures stale > 48 h; each links a runbook. Deploy markers emitted by deploy.yml.

## Options considered

| Option                                                  | Pros               | Cons                                       |
| ------------------------------------------------------- | ------------------ | ------------------------------------------ |
| OTel + external OTLP backend (chosen, pending approval) | Standard, portable | New external host, cost                    |
| Railway logs/metrics only                               | No new vendor      | No traces, no SLO alerting — fails OB-1..5 |

## Consequences

Observability is "logs-only" until KR approves a backend; SLO alerting is a go-live prerequisite (open risk).

## Compliance check

Logger redaction unit tests; a contract test on one request asserts requestId/traceId fields; runbook links in alert defs.
