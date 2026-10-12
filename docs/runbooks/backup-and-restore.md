# Backup and restore

What is backed up, how to read and verify it, how to restore it, and the quarterly drill. Source: ADR-0007, ADR-0008
(exception 5), ADR-0011, PRODUCT_SPEC 14 and 17, `services/ops/src`, [deploy/railway.md](../deploy/railway.md) "Bucket
findings". The restore commands below were run against a local Postgres 17 (bootstrap, restore, migrate, privilege
check), not against Railway: the drill is where Railway's own restore behaviour is recorded.

## Recovery points

| Point                    | Where                                                     | Taken                                     | Kept                                          |
| ------------------------ | --------------------------------------------------------- | ----------------------------------------- | --------------------------------------------- |
| Railway Postgres backups | Railway, per environment (turn ON at set-up)              | Daily, plus weekly or monthly on the plan | Per Railway plan; record the schedule         |
| Nightly dump             | `backups` bucket, `db/nightly/<UTC stamp>.dump`           | 18:15 UTC (02:15 Perth) by `backup`       | 35 days; the newest is always kept            |
| Pre-migration dump       | `backups` bucket, `db/pre-migrate/<stamp>-<release>.dump` | By `migrate`, before pending migrations   | 35 days; the newest is always kept            |
| Object copies            | `backups` bucket, `objects/<files-bucket key>`            | Nightly, incremental                      | Until 35 days after the source object is gone |
| Copy manifest            | `backups` bucket, `manifest.json`                         | Nightly                                   | Rewritten each run                            |

The `files` bucket has no versioning and no bucket backups: an overwritten or deleted object is recoverable only from
`objects/`. The app purges a deleted file's object 30 days after deletion, so a mistaken delete is recoverable inside
that window. Worst-case data loss is about a day (nightly cadence). A recovery time objective is not defined in the
specification; the drill measures it and KR should set one (open question).

## Read and verify (no database needed)

Use any S3 client with the `backups` bucket's keys from the password manager, set up once as a named profile.

```sh
aws s3 ls --profile kr-backups --endpoint-url <backups endpoint> s3://<backups bucket>/db/nightly/
aws s3 cp --profile kr-backups --endpoint-url <backups endpoint> s3://<backups bucket>/db/nightly/<stamp>.dump .
sha256sum <stamp>.dump          # equals "sha256" in the log event ops_backup_dump_stored of that run
pg_restore --list <stamp>.dump | head   # PostgreSQL 17 tools; "Dumped from database version: 17.x"
```

A dump holds client data: keep it on an encrypted disk, never in the repository or a chat, and delete it after use.

## Restore into a scratch database

The scratch server must be a **separate Postgres 17 instance**: `bootstrap-cli` resets the role passwords for the whole
server, so running it against production's Postgres would break production. A local container is enough:
`docker run --rm -d --name kr-scratch -e POSTGRES_PASSWORD=<throwaway> -p 55432:5432 postgres:17-alpine`.

Confirm before running: the host in `SUPERUSER_DATABASE_URL` is the scratch server (`localhost` or the throwaway
service), not a name ending `.railway.internal` for a live service.

```sh
createdb -h localhost -p 55432 -U postgres restore
SUPERUSER_DATABASE_URL=postgres://postgres:<throwaway>@localhost:55432/restore \
TRACKER_MIGRATOR_PASSWORD=<16+ throwaway> TRACKER_APP_PASSWORD=<16+ throwaway> \
TRACKER_BACKUP_PASSWORD=<16+ throwaway> \
  node packages/db/dist/bootstrap-cli.js                    # three roles, citext, schema, default privileges
pg_restore --clean --if-exists --exit-on-error --no-password \
  -d postgres://postgres:<throwaway>@localhost:55432/restore <stamp>.dump
```

Do **not** add `--no-owner` or `--no-privileges` when the result is to be used: the dump carries the revokes that stop
`tracker_app` changing `audit_events`. Then check:

```sql
SELECT count(*) FROM tracker.jobs;  SELECT max(version) FROM tracker.schema_migrations;
SELECT has_table_privilege('tracker_app', 'tracker.audit_events', 'UPDATE');   -- must be f
```

and prove the dump matches the code: `MIGRATION_DATABASE_URL=<scratch tracker_migrator URL> node packages/db/dist/migrate-cli.js`
applies any migrations newer than the dump and fails on a checksum mismatch (`"applied":0` for a current dump).

## Restore objects

Single file (a mistaken delete): find the row, never copy over an existing object.

1. `SELECT storage_key, encode(sha256, 'hex') FROM tracker.files WHERE id = '<file id>';` (read-only session).
2. Download `objects/<storage_key>` from the `backups` bucket and compare `sha256sum` with step 1. Different: stop.
3. Confirm before running: `aws s3api head-object` on the `files` bucket for that key answers not found, and the file
   row's `deleted_at` is null or inside the 30-day window. Then `aws s3 cp` to the `files` bucket (read/write keys), at
   the same key. Delete the local copy.

Whole bucket (after a database restore, so keys line up). The list of keys comes from the restored database, never from
the `objects/` listing: `objects/` keeps a copy for 35 days after its source is gone, so copying it whole would bring
back files that were deleted or purged, against the 30-day purge retention (PRODUCT_SPEC 11 and 14).

1. Build the key list (read-only session on the restored database). Rows with `purged_at` set are excluded. Rows with
   `deleted_at` set and `purged_at` null are inside the 30-day window and are included: the object must exist for the
   purge job and for a mistaken delete to be undone, and users still cannot reach them. Files marked `infected` are
   left out (see [malware-detected](malware-detected.md)). Rows with `pending` or `error` are included and are scanned
   again by the worker.

   ```sql
   \copy (SELECT storage_key FROM tracker.files WHERE purged_at IS NULL AND scan_status <> 'infected' ORDER BY storage_key) TO 'keys.txt'
   \copy (SELECT encode(sha256, 'hex') || '  restore-objects/' || storage_key FROM tracker.files WHERE purged_at IS NULL AND scan_status <> 'infected' ORDER BY storage_key) TO 'sums.txt'
   ```

2. Download exactly those keys from `objects/` and verify them. A missing or mismatched object is listed, not skipped:
   resolve each one with KR before going on (a missing object is a file lost from the backup too).

   ```sh
   while read -r k; do
     aws s3 cp --only-show-errors --profile kr-backups --endpoint-url <backups endpoint> \
       "s3://<backups bucket>/objects/$k" "restore-objects/$k" || echo "$k" >> missing.txt
   done < keys.txt
   sha256sum --quiet -c sums.txt            # prints only failures
   ```

3. Confirm before running: the environment and the `files` bucket (read/write keys) are the ones being restored, the
   restored database is the one the service now uses, `missing.txt` is empty or agreed, and `sha256sum` printed
   nothing. Take a listing of the destination and run the dry run against it, with the same arguments the real command
   will have. Every line the dry run prints must be a key that is absent from the destination listing. If a key already
   exists in the destination with a different size, stop: this runbook never overwrites an object. Post the output for
   the second person in production.

   ```sh
   aws s3 ls --recursive --profile kr-files --endpoint-url <files endpoint> s3://<files bucket>/ | awk '{print $4}' | sort > dest-keys.txt
   aws s3 sync --dryrun --size-only --profile kr-files --endpoint-url <files endpoint> restore-objects/ s3://<files bucket>/ | sed 's/.* to s3:\/\/<files bucket>\///' | sort > would-upload.txt
   comm -12 would-upload.txt dest-keys.txt      # must print nothing (nothing would overwrite an existing key)
   wc -l keys.txt would-upload.txt              # would-upload is at most keys.txt
   ```

4. Run the same `aws s3 sync --size-only` command without `--dryrun`. Never use `aws s3 cp --recursive` here: it
   overwrites every key. Scan state is in the database, so restored objects of `clean` rows serve again. Delete
   `restore-objects/` and the list files afterwards (they name keys, not people, but the objects are client data).

## Recover production

Severity 1 or 2 ([incident-response](incident-response.md)); KR agrees the recovery point and the data-loss window first
(state it from `audit_events.occurred_at`).

1. Freeze deploys ([deploy-and-rollback](deploy-and-rollback.md)). If the failure is Railway's own, consider Railway's
   backup restore first and write down what it did.
2. Add a new Postgres 17 service in the environment, enable its TCP proxy, run `bootstrap-cli` against it with **new**
   role passwords, then `pg_restore` as above, using the dump KR chose. Verify with the checks above.
3. Quiesce: stop the active deployments of `web`, `api`, `worker` and `backup` in the dashboard.
4. Set the sealed variables to the new host and passwords: `DATABASE_URL` on `api` and `worker`,
   `MIGRATION_DATABASE_URL` on `migrate`, and `BACKUP_DATABASE_URL` (`tracker_backup`) on `backup`, which reads no other
   database URL: left on the old one it keeps dumping the old database. Then bring the services back in the order `deploy.yml` uses:
   `clamav`, **`migrate`**, `api`, `worker`, `web`, `backup`. `migrate` always comes first and must answer `/healthz`
   with 200 before `api` or `worker` starts, so the application never runs on a schema older than its images expect.
   Compare `max(version)` from step 2 with the newest file in `packages/db/migrations/` of the release you will run.
   - Dump older than the running release (for example a nightly dump taken before a release that carried a migration):
     `migrate` will apply the pending migrations and first take a pre-migrate dump of the restored database
     (`ops_migrate_backup_stored`). That is expected; do not treat it as an error. Nothing pending means no dump.
   - Dump is the **pre-migration dump of a bad migration** ([database-migrations](database-migrations.md), step 4): the
     `migrate` image that is deployed now would apply that bad file again. Do not redeploy the same images. Deploy the
     last good tag, or the fixed release, through `deploy.yml` (workflow `deploy`, "Run workflow", enter the tag), whose
     `migrate` then finds nothing pending or only fixed files. Its deploy steps are blocked while `DEPLOYS_FROZEN` is
     `true`: set it to `false` for this run only, make sure nobody else launches a release, and freeze again after.
     Staging deploys first and production waits for approval ([deploy-and-rollback](deploy-and-rollback.md)).
   - Dump is current with the running release: a dashboard redeploy of the current images is enough, in the order above
     (`migrate` first, wait for `/healthz`). `migrate` logs nothing pending.
5. Smoke test: `node infra/railway/scripts/smoke.mjs --base-url https://<web domain>`, sign in, open a job and a file.
6. Keep the old Postgres for 7 days for comparison, then delete it only after KR signs off (Confirm: the service name,
   and that nothing reads from it). Lift the freeze. Record the data-loss window.

## Emergency manual dump

When `backup` is failing and a recovery point is needed now ([backup-failed](backup-failed.md)). From a workstation with
PostgreSQL 17 tools and the TCP proxy on, as the read-only `tracker_backup` role (the one `backup` uses; `pg_dump` needs
only SELECT):

```sh
read -rs PGPASSWORD; export PGPASSWORD
pg_dump --format=custom --no-password --lock-wait-timeout=30s --file=kr-<env>-<UTC stamp>.dump \
  "postgres://tracker_backup@<proxy host>:<port>/<db>?sslmode=require"
sha256sum kr-<env>-<UTC stamp>.dump
aws s3 cp --profile kr-backups --endpoint-url <backups endpoint> kr-<env>-<UTC stamp>.dump s3://<backups bucket>/db/manual/<UTC stamp>.dump
```

`db/manual/` is outside the retention job: record the key and delete it by hand when it is no longer needed.

## Rebuilding the manifest

`ManifestError` ("manifest.json ... unreadable; fix or delete it") fails the object copy until `manifest.json` is fixed.
Deleting it is safe for the data but restarts the retention clocks: copies whose sources are already gone are kept
another 35 days, so deleted client files live longer in backup (it affects PRODUCT_SPEC 14 retention).

Confirm before running: the `ManifestError` line is in the latest `backup` run (not an older one) and names this
environment; the bucket is **this environment's** `backups` bucket (staging and production differ); the only object
touched is the single key `manifest.json` (no prefix, no `--recursive`); KR has been told and it is recorded in the
operations log; in production a second person has read the output of the check below.

```sh
aws s3api head-object --profile kr-backups --endpoint-url <backups endpoint> --bucket <backups bucket> --key manifest.json
aws s3api delete-object --profile kr-backups --endpoint-url <backups endpoint> --bucket <backups bucket> --key manifest.json
```

Check the next run's `ops_backup_objects_planned` line.

## Quarterly drill

Run it each quarter and after any change to the backup service, Postgres major version or bucket. Staging data is
synthetic, so the full path is drilled there; a production dump is checked and restored only where real data may be
(an encrypted device KR approves, or a throwaway Postgres service in the production Railway project). Copy the template
below into the operations log and fill every line; no names, emails or file names, only counts, keys and hashes.

```text
Restore drill  <YYYY-MM-DD>   Operator: <name>   Second person: <name>
Environment drilled: staging | production      Dump key: db/nightly/<stamp>.dump   Age at drill: <hours>
[ ] Railway Postgres backups exist (schedule noted: <...>)             Newest: <UTC>
[ ] SLO-6: every nightly run in the last 30 days succeeded             Failures: <n>
[ ] sha256 of the downloaded dump matches ops_backup_dump_stored        <hash prefix>
[ ] pg_restore --list reads the whole archive; server version <17.x>
[ ] Scratch server is separate from production (host: <...>)
[ ] bootstrap-cli printed "bootstrap complete"; pg_restore exit 0 with --exit-on-error
[ ] Row counts: jobs <n> files <n> audit_events <n>; max schema_migrations version <NNNN>
[ ] has_table_privilege(tracker_app, audit_events, UPDATE) = false
[ ] migrate-cli against the restored database: applied <n>, no checksum error
[ ] Three clean files restored from objects/, sha256 matches the database    ids: <3 file ids>
[ ] Railway backup restore tried into a throwaway staging service          Behaviour/time: <...>
[ ] Cleanup: scratch dropped, local files deleted, TCP proxy off, throwaway services removed
Timings: download <min>  restore <min>  verify <min>  total <min> (observed recovery time)
Findings / follow-up tickets: <...>
Result: pass | fail
```

A failed drill is a ticket with an owner and a date, and the next drill runs sooner.
