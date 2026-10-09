# Database migrations

How schema changes are made, how they reach production, and what to do when one goes wrong. Source: ADR-0007, ADR-0008,
`docs/spec/DATA_MODEL.md` section 8, `packages/db/src/migrate.ts`, `services/ops`.

## The rules

- Forward-only SQL files `packages/db/migrations/NNNN_snake_name.sql`, applied in order, **each in its own transaction**,
  by the `migrate` service as `tracker_migrator`. The `api` never holds DDL credentials.
- Applied files are immutable: the runner stores each checksum and fails the deploy if an applied file changes.
- The runner takes an advisory lock, sets `lock_timeout` to 5 s and `statement_timeout` to 120 s. A file whose first
  line is `-- migrate:no-transaction` runs outside a transaction and must hold exactly one statement (use it for
  `CREATE INDEX CONCURRENTLY` on populated tables).
- Lint: `pnpm --filter @kr/db db:migration:lint` (Squawk, configuration in `packages/db/.squawk.toml`). Name the next file by hand with the
  next four-digit number; the runner rejects any other file name and duplicate numbers.
- Schema changes touch three places: the SQL file, `packages/db/src/schema.ts`, and (reference data) the workflow seed test.

## Expand and contract

Every release must run against the schema before **and** after its migrations, because rollback redeploys old images on
the new schema. So a change is split across releases:

| Release      | Step                                                                                           |
| ------------ | ---------------------------------------------------------------------------------------------- |
| N            | Expand: add the nullable column, table or index (concurrently). Code works with or without it. |
| N            | Code writes both old and new. Backfill with a worker job, not inside a migration.              |
| N+1          | Code reads the new shape only.                                                                 |
| N+2 or later | Contract: drop the old column or table, after reads stopped and one release has run clean.     |

Never rename or drop in the release that stops using the thing, never add a `NOT NULL` without a default to a populated
table, never edit an applied file.

## What happens on a deploy

`migrate` lists pending files. If any, it streams `pg_dump --format=custom` straight into the `backups` bucket at
`db/pre-migrate/<UTC stamp>-<release>.dump` and logs `ops_migrate_backup_stored` with the size and sha256. Only then does it
apply them. With nothing pending it takes no dump but still re-checks checksums. Only after success does `/healthz`
answer 200, which lets the deploy continue to `api`. Staging always runs a release first, so a migration is rehearsed on
staging data (not production volume: check the size of big tables before a heavy statement).

## When the migrate service fails

Follow [migrate-failed](migrate-failed.md). The summary:

| Where it failed           | State of the database                              | What to do                                                     |
| ------------------------- | -------------------------------------------------- | -------------------------------------------------------------- |
| Before or during the dump | Untouched                                          | Fix the cause (bucket, password), redeploy the same tag        |
| Lock or statement timeout | The failed file rolled back; earlier files applied | Retry, or fix the migration and release again                  |
| SQL error in a file       | The failed file rolled back; earlier files applied | Fix forward: correct the unapplied file, new release           |
| Checksum mismatch         | Nothing applied past it                            | Restore the applied file byte for byte; add a new file instead |

The previous application version keeps serving throughout: `deploy.yml` stops before `api`, `worker` and `web`.

## Recovering after a bad migration

Use this only when a migration **applied** and is wrong (wrong data, a lost column), not when it failed.

1. Stop the harm: roll back the application ([deploy-and-rollback](deploy-and-rollback.md)) and freeze deploys. The old
   images run on the new schema, which is why migrations are expand-only.
2. Prefer **fixing forward**: a new expand migration or a data repair script reviewed like any change.
3. If rows or columns were lost, recover from the dump taken by that very deploy: find `db/pre-migrate/<stamp>-<release>.dump`
   in the `backups` bucket, restore it into a scratch database and compare ([backup-and-restore](backup-and-restore.md),
   "Restore into a scratch database"). Copy back only what is needed, row by row, inside a transaction, with a second
   person checking in production.
4. A **full restore** of production to the pre-migration dump loses everything written since the dump (every user
   edit and upload after the migrate step). It is a severity 1 decision for KR, made through
   [incident-response](incident-response.md), with the lost window stated in minutes from the audit trail first.
5. Write the incident note and add the missing test or Squawk rule.
