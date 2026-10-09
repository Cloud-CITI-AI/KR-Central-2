# ADR-0006: Asynchronous work through a Postgres operations queue and a worker service

- Status: proposed
- Date: 2026-10-09
- Deciders: KR Surveys (Craig) — pending; drafted for review
- Drafted by: agent claude (orchestrator) for the launching human
- Related: docs/spec/PRODUCT_SPEC.md, ADR-0004, ADR-0011

## Context

The prototype parsed PDFs (pdf.js), Outlook .msg/.eml files and called a vision model **in the browser**. Server-side we
must: scan uploads for malware, extract WAPC conditions and dates from Decision Letters, read conformance stamps
(optionally with Claude vision) and parse emails. These are slow, CPU-heavy and handle untrusted input.

## Decision

- A single table `operations` is both the user-visible status ("Reading Decision Letter…") and the queue. API modules
  enqueue in the same transaction as the triggering change; the worker claims with `FOR UPDATE SKIP LOCKED`, a lease
  (`locked_until`), retries with exponential back-off, and records `result`/`error` (`packages/db/src/queue.ts`).
- The UI polls `GET /v1/operations/{id}` and refetches the job on success.
- The worker runs each document task with page caps (`PDF_MAX_PAGES`), a time limit, and in a separate container with no
  inbound network.
- Parsing logic is pure and tested in `packages/document-parsing` (port of the prototype functions).

## Options considered

| Option                         | Pros                                                         | Cons                                                                                  |
| ------------------------------ | ------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| Postgres table queue (chosen)  | No new infrastructure, transactional enqueue, visible status | Polling; fine at this scale                                                           |
| pg-boss / graphile-worker      | Mature                                                       | Need DDL at runtime (conflicts with DB-6 least privilege) or vendor schema management |
| Redis + BullMQ                 | Fast                                                         | Another Railway service and failure mode                                              |
| Parse synchronously in the API | Simple                                                       | Untrusted parsing in the API process; request timeouts                                |

## Consequences

Worker must be deployed for scans and parsing; with `MALWARE_SCAN_MODE=required` uploads stay "Scanning…" until it runs.

## Compliance check

Queue integration tests (single claim under concurrency, lease expiry, retries); worker handler tests with synthetic files.
