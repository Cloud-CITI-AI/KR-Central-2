# backup-failed

Alert: [backup-failed](../observability/alerts.md#backup-failed) (page). Objective SLO-6: every nightly run succeeds.
Fires on `kr.backup.runs{result="failure"}` and when no run succeeded within 26 hours. The `backup` cron service runs
daily at 18:15 UTC (02:15 Perth): a database dump to `db/nightly/`, an incremental copy of the `files` bucket to
`objects/`, then pruning of dumps older than 35 days (the newest dump per prefix is always kept).

## Symptoms

- The `backup` deployment shows failed; log event `ops_backup_failed`; or no recent deployment at all (cron did not fire).
- The `backups` bucket has no `db/nightly/<UTC stamp>.dump` for the last day.

## Dashboards

7 Delivery and backups (`kr.backup.runs`, hours since last success).

## Diagnose (read-only)

1. **Which step.** Logs of the latest `backup` run: `ops_backup_step_failed` has `step` of `database dump`,
   `object copy` or `dump retention`. The steps are independent, so one failing does not stop the others. Pruning is
   skipped when the dump failed. `ops_backup_dump_stored` and `ops_backup_objects_copied` show what did work.
2. **Did it start.** No log at all: the cron did not run (Railway cron status, a deployment stuck, a bad schedule in
   the settings drift report of the last deploy). A healthy cron deployment shows `SUCCESS` or `SLEEPING` between runs.
3. **Dump failures.** `PgDumpError` text: connection refused or password failed (the migrator password was rotated
   and `MIGRATION_DATABASE_URL` on `backup` still has the old one: today's code makes `backup` hold it), or a server
   newer than pg_dump 17. "stored dump is N bytes, expected M" or an upload error: the `backups` bucket.
4. **Copy failures.** `ops_backup_object_failed` or `ops_backup_purge_failed` with an object key; `config_invalid`
   naming `S3_*` variables means the read-only `files` keys are missing. `ManifestError` ("manifest.json ... is
   unreadable; fix or delete it") means the bucket's `manifest.json` is damaged; do not delete it before reading
   [backup-and-restore](backup-and-restore.md) "Rebuilding the manifest".
5. **What recovery points exist right now.** List `db/nightly/` and `db/pre-migrate/` in the `backups` bucket and
   check Railway's own Postgres backups for the environment. State the age of the newest of each.

## Mitigate

1. Fix the cause: restore the correct variable, rotate a broken bucket key
   ([secrets-rotation](secrets-rotation.md)), or free space in the bucket.
2. **Run a backup now.** Redeploy the `backup` service from the Railway dashboard so it runs immediately, and watch the
   log for `ops_backup_finished`. If the dashboard does not run a cron service on redeploy, take an emergency dump with
   the command in [backup-and-restore](backup-and-restore.md) "Emergency manual dump" and note it.
3. Until a good dump exists, avoid risky changes: freeze deploys (`DEPLOYS_FROZEN=true`); a release would take its own
   pre-migration dump, but only if its migrations are pending.

## Escalate

No successful dump for 48 hours, or the Railway Postgres backups also failing: incident
([incident-response](incident-response.md)), severity 2. Tell KR that recovery currently depends on a single copy.
After the fix, check the next scheduled run too and record both in the operations log.
