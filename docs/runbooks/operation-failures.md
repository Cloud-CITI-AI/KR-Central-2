# operation-failures

Alert: [operation-failures](../observability/alerts.md#operation-failures) (ticket). Objective SLO-4. Fires when over
20 % of one type's operations fail in 30 minutes (at least 5), or when more than half of AI stamp readings in an hour end
in `error`, `timeout` or `unparseable`.

## Symptoms

- Users see "Couldn't read…" style messages under a card, or a conditions extraction that fails.
- `kr.operations.processed{status="failed"}` rises for one `type`; `kr.ai.stamp_reading` shows non-`read` results.

## Dashboards

3 Worker and queue (failure ratio by type, stamp reading by result, duration).

## Diagnose (read-only)

1. **What is failing and why** (read-only session, [README](README.md#a-read-only-sql-session)):

   ```sql
   SELECT type, error_code, count(*) AS n, min(completed_at) AS first, max(completed_at) AS last
   FROM tracker.operations
   WHERE status = 'failed' AND completed_at > now() - interval '24 hours'
   GROUP BY type, error_code ORDER BY n DESC;
   ```

2. **User-caused or system-caused.** `not_a_pdf`, `encrypted_pdf`, `too_many_pages`, `unreadable_pdf`, `invalid_msg`,
   `invalid_eml`, `too_complex` mean a bad input: one customer, a ticket and a note to KR staff. `internal_error`,
   `scan_unavailable`, `scan_error`, `timeout`, `lease_expired`, `file_unavailable`, `file_missing`,
   `render_failed` across many jobs mean a platform fault. `error_message` is fixed text with no file contents; still do
   not paste it next to a job number and client in a public place.
3. **Started at a deploy** or when the flag changed? Compare the first failure time with deploy markers and
   `docs/flags.md`.
4. **Stamp reading.** Logs `stamp_reading_failed` and `circuit_state_changed` (the Anthropic breaker opens after 3
   service failures in a row). Reading falls back to the text rule, so users lose only the automatic stamp date.
5. **Scan errors** have their own runbook: [malware-scan-errors](malware-scan-errors.md).

## Mitigate

1. Platform fault from a release: roll back ([deploy-and-rollback](deploy-and-rollback.md)).
2. Stamp reading failing (Anthropic outage, rejected or exhausted key): turn the flag off: set
   `FEATURE_AI_STAMP_READING=false` on `worker` and `api` and redeploy both ("Killing a flag" in
   [deploy-and-rollback](deploy-and-rollback.md)). Nothing else changes. A rejected key is
   [secrets-rotation](secrets-rotation.md). Turn the flag on again only after a clean staging reading.
3. Infrastructure behind it (database, bucket, clamd): treat as that alert.
4. A user-caused failure needs no change; tell the staff member to enter the date or fix the file, as the on-screen
   message says (conformed date entry is always available).

## Escalate

Failure ratio above 50 % for an hour for any type, or failures that cannot be explained by input or a dependency:
incident ([incident-response](incident-response.md)), severity 3. A parser crash on a hostile file is a security matter:
keep the operation id and open a security ticket.
