# Unarchive a job

Archiving hides a job from everyone and stops client and architect access, but keeps its files and history (PRODUCT_SPEC
5.1). The application has **no un-archive**; this is the operator procedure. The only state archiving sets is
`jobs.deleted_at`, `deleted_by` and a version bump, so undoing it is one guarded UPDATE and an audit row.

Only on a written request from a `kr_admin` or `admin` (a ticket id goes in the audit row). Run it as `tracker_app`
([database](database.md)): the app's own privileges apply, including that audit rows can only be added.

## 1. Find the job and check it can come back

Use a read-only session ([README](README.md#a-read-only-sql-session)); `<number>` is the job number.

```sql
SELECT id, job_number, deleted_at, version FROM tracker.jobs WHERE job_number = '<number>' AND deleted_at IS NOT NULL ORDER BY deleted_at DESC;
SELECT id FROM tracker.jobs WHERE job_number = '<number>' AND deleted_at IS NULL;      -- must return no rows
SELECT occurred_at, action, actor_user_id FROM tracker.audit_events WHERE job_id = '<id>' AND action = 'job.archived';
SELECT role, status, count(*) FROM tracker.access_grants WHERE job_id = '<id>' GROUP BY role, status;
```

- No archived row, or several: stop and ask KR which `<id>` it means.
- A live job already uses the number (job numbers are reusable once archived): stop. The restore would break R15
  (unique among active jobs). KR must rename one of them first, through the application.
- The last query shows who regains access: active client and architect grants work again as soon as the job is visible.
  KR must agree to that.

## 2. Confirm before running

All of these are true: the environment is the right one; the ticket and approver are in the operations log; the first
query returned exactly one row and you have its `id` and `version`; the second returned none; a second person has read
the `id` and `version` back (production).

## 3. Restore

```sql
BEGIN;
UPDATE tracker.jobs SET deleted_at = NULL, deleted_by = NULL, version = version + 1
WHERE id = '<id>' AND deleted_at IS NOT NULL AND version = <version>
RETURNING job_number, version;        -- must say UPDATE 1 (one row)
INSERT INTO tracker.audit_events (actor_type, action, job_id, entity_type, entity_id, request_id, changes)
VALUES ('system', 'job.unarchived', '<id>', 'job', '<id>', 'operator:<ticket>', '{"archived": {"from": true, "to": false}}');
-- inspect the output; then COMMIT; if anything is not exactly as expected, ROLLBACK;
```

`UPDATE 0` means the job changed since you looked (or the version differs): `ROLLBACK`, then repeat from step 1.

## 4. Verify and record

As an admin open the dashboard and the job: it is listed, its files open, and its progress matches before. Anyone with the
tracker open on that job gets the normal "Someone else changed this" reload because the version moved. Check
`/admin/audit` for `job.unarchived`. Tell the requester, and note the ticket, time and who in the operations log.
To archive it again, an admin uses **Archive job…** on the job.
