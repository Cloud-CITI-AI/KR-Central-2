# worker service

Background work of the tracker (ADR-0006, ADR-0010, ADR-0011): it claims `operations` rows from Postgres, scans uploads with ClamAV, reads documents in
isolated threads, and runs the hourly sweeps. Nothing here is on a request path; the API only enqueues and polls.

## Layout

| Path                | What                                                                                                                         |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `main.ts`, `app.ts` | Process entry (telemetry first, config, pool, SIGTERM) and the assembly of health server, poller, sweeper and gauges.        |
| `poller.ts`         | `FOR UPDATE SKIP LOCKED` leases, heartbeat at a third of the lease, per-handler time limit, idle back-off, lease requeue.    |
| `handlers/`         | One handler per operation type (`file-scan`, `email-parse`, `conditions-extract`, `conformance-read`); `index.ts` registers. |
| `domain/`           | Pure rules (scan failure judgement, email columns, extraction summary, the §10.1 order, retention cut-offs). No I/O.         |
| `data/`             | Kysely statements. `clients/`: clamd, the stamp reader (interface + Anthropic). `parsing/`: the `worker_thread` isolation.   |
| `sweeps/`           | The hourly sweeper (advisory lock) and the task list.                                                                        |

## Operations

Payloads are validated with zod; an invalid one fails `invalid_payload`. Every handler is idempotent (a lease expiry re-runs it). Audit rows are written
in the same transaction as the change, by the system actor (`actor_type = system`), with ids and changed fields only: never file names, text or content.

| Type                 | Payload                     | Does                                                                                                                                                | Result (operations.result)                                         | Audit action                       |
| -------------------- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ---------------------------------- |
| `file.scan`          | `{fileId}`                  | Streams the object to clamd; `clean` / `infected` (object deleted) / `error`; `skipped` when MALWARE_SCAN_MODE=disabled; queues `email.parse`.      | `{scanStatus}`                                                     | `file.infected`                    |
| `email.parse`        | `{fileId}`                  | `.msg` / `.eml` in the parse thread into `email_messages` (`parsed` or `failed`). Pasted emails are already parsed.                                 | `{parseStatus}`                                                    | none                               |
| `conditions.extract` | `{fileId, replaceExisting}` | Decision Letter in the parse thread; supersedes the current conditions and their evidence, inserts the new ones, sets approval date and expiry.     | contract `ConditionsExtractResult` (count, guessed numbers, dates) | `conditions.extracted` (operation) |
| `conformance.read`   | `{fileId, allowAi}`         | §10.1 order: file name, stamp annotation, AI stamp reading (only if `allowAi` and the flag and the key), text. Overwrites the job's conformed date. | contract `ConformanceReadResult`                                   | `conformance.date_read` (job)      |

Failure codes the API shows (it owns the wording of the known ones, `operation-view.ts`): `not_a_pdf`, `encrypted_pdf`, `too_many_pages`, `unreadable_pdf`, `render_failed`,
`invalid_msg`, `invalid_eml`, `timeout`, `lease_expired`. Others set by the worker, with plain-prose messages: `too_complex` (memory limit of the parse thread), `parse_failed`,
`file_unavailable`, `file_not_ready`, `file_missing`, `file_too_large`, `job_unavailable`, `replace_required`, `scan_unavailable` (retryable), `scan_error`, `unsupported_operation`,
`invalid_payload`, `internal_error` (retryable, fixed generic text). Retryable failures go back on the queue with the shared back-off until `max_attempts`.

## Limits

- Parse thread: heap cap 512 MB (+64 MB young), 60 s, the page cap `PDF_MAX_PAGES`, empty environment. The parent also samples the thread's memory every 50 ms because V8's heap limit is
  ignored under `NODE_OPTIONS=--max-old-space-size` and does not count Buffers.
- Handler time limits: file.scan max(120 s, 2 x CLAMAV_TIMEOUT_MS); email.parse and conditions.extract 120 s; conformance.read 240 s. The AI call is bounded by ANTHROPIC_TIMEOUT_MS in total.
- clamd: socket idle timeout CLAMAV_TIMEOUT_MS; a stream over CLAMAV_STREAM_MAX_BYTES is refused before clamd cuts it off. A scan with no verdict is never `clean`.

## Scan errors

While an operation has attempts left, a scanner or storage failure re-queues it (`scan_unavailable`) and the file stays `pending`. On the last attempt (or at once for a file over the
scanner's limit or a missing object) the file becomes `error`, `scan_attempts` goes up by one and the operation fails. The hourly sweep scans a file in `error` again after failure 1, 2 and 3
(`mayRescan`, SCAN_ERROR_MAX_RETRIES = 3); after the fourth failure it stays `error` and the log event `scan_retries_exhausted` (error level) is the alert signal (runbook `malware-scan-errors`).

## Sweeps (hourly, first one 60 s after start, one worker at a time through `pg_try_advisory_lock`)

`purge_files` (objects of files soft-deleted over 30 days ago; sets `purged_at`; audit `file.purged`), `expired_rows` (sessions 7 days after expiry or revocation, expired sign-in flows,
idempotency keys over 24 h, expired rate-limit rows), `rescan_errors`, `requeue_stuck_scans` (pending over 15 minutes with no scan queued or running).

## Signals

Metrics (`@kr/telemetry`): `kr.operations.processed` / `duration` (final states only), `queue_depth` / `queue_age` (due queued operations per type), `kr.files.scanned{result}`,
`kr.ai.stamp_reading{result}`. Log events (ids and codes only, no personal data): `malware_detected`, `scan_failed`, `scan_retries_exhausted`, `operation_succeeded`, `operation_requeued`,
`operation_failed`, `lease_lost`, `leases_requeued`, `stamp_reading_failed`, `purge_failed`, `sweep_completed`, `sweep_task_failed`, `clamd_unreachable`.

## Running and testing

`pnpm --filter @kr/worker dev` needs a Postgres, an S3 endpoint and, unless `MALWARE_SCAN_MODE=disabled`, clamd (`docker compose up -d postgres s3 clamav` at the root). Built, the worker needs
the workspace packages built first (`pnpm build`). Integration tests use Testcontainers (Postgres 17; the real ClamAV image with `infra/clamav/clamd.conf` in `clamd.real.int.test.ts`,
about 30 s) and run one file at a time because pollers share the operations table. Domain mutation score: `pnpm --filter @kr/worker test:mutation` (100 % at the time of writing).
