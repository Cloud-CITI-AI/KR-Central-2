# migrate-failed

Alert: [migrate-failed](../observability/alerts.md#migrate-failed) (page). Delivery. Fires when the `migrate` service
reports a failed or crashed deployment, or `deploy.yml` fails at the migrate step. The `migrate` service is healthy only
after every pending migration succeeded, and `deploy.yml` deploys `api`, `worker` and `web` after it, so a failure stops
the release before any new application code runs. The previous version keeps serving.

## Symptoms

- The `deploy` run is red at `migrate`, with `[migrate] ...` naming the reason; no user impact yet.
- `migrate` logs `ops_migrate_failed` or `ops_migrate_start_failed`.

## Dashboards

7 Delivery and backups (migrate status per deploy, latest pre-migration dump age). The GitHub Actions run is the main
source.

## Diagnose (read-only)

1. **Is anything half-deployed.** `deploy.yml` rolls back services it changed when a step fails; confirm in the run
   that "Roll back" ran and that `api`, `worker` and `web` still show the previous release. Run
   `node infra/railway/scripts/smoke.mjs --base-url https://<web domain>`.
2. **The error.** `migrate` service logs, in order: `ops_migrate_pending` (which files), `ops_migrate_backup_stored`
   (the dump key, size and sha256), `ops_migration_applying` per file, then the failure.
   - `pg_dump failed` or no `ops_migrate_backup_stored`: the dump failed first, so **nothing was changed**. Causes: the
     `backups` bucket keys or endpoint, the migrator password, `PG_DUMP_PATH`, a Postgres major above 17.
   - `canceling statement due to lock timeout`: another transaction held a lock for 5 seconds. Transient or a long
     query: [db-connections-saturated](db-connections-saturated.md). Retrying is safe.
   - `statement timeout` (120 s) or a SQL error: the migration itself is wrong or too heavy.
   - `was modified after being applied (checksum mismatch)`: an applied migration file was edited. Never do that.
3. **What is applied** (read-only session, [README](README.md#a-read-only-sql-session)):

   ```sql
   SELECT version, name, applied_at FROM tracker.schema_migrations ORDER BY version DESC LIMIT 5;
   ```

   Each file runs in its own transaction, so a failed file left no trace; earlier files from the same run are applied.

## Mitigate

1. **Transient (lock timeout, bucket blip):** run `deploy.yml` again with `workflow_dispatch` for the same tag
   ([deploy-and-rollback](deploy-and-rollback.md)). The runner is idempotent and takes a new dump.
2. **The migration is wrong:** freeze deploys (`DEPLOYS_FROZEN=true`), fix forward in a pull request, release a new tag.
   A file that never applied may be corrected in place; a file that applied must never be edited, add a new one.
   Squawk and the expand/contract rules are in [database-migrations](database-migrations.md).
3. **Never** run the migration by hand against production, never use the Postgres superuser to patch the schema, and
   never delete rows from `tracker.schema_migrations`. If a migration did apply and damaged data, the recovery is
   [database-migrations](database-migrations.md) "Recovering after a bad migration" (restore from the pre-migration dump).

## Escalate

A failed migration whose dump is missing, or any sign data was changed by a half-applied step: incident
([incident-response](incident-response.md)), severity 1. No release goes out until `migrate` is green in staging.
