# Secrets rotation

Every secret, who holds it, how often it changes, and how to change it without an outage. Source: ADR-0013, ADR-0008
(exception 1 and 7), [deploy/railway.md](../deploy/railway.md) (variables per service, Entra checklist E7 and E8).
Rotate **staging first**, check, then production. Secrets are Railway **sealed** variables (write-only) or GitHub
Environment secrets; the password manager is the record. Never print a secret, put it in a ticket, or leave it in shell
history; use a prompt (`read -rs`) or an environment file outside the repository.

## Inventory

| Secret                                                           | Held by                                                                                                  | Cadence        | Section                                          |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | -------------- | ------------------------------------------------ |
| `ENTRA_CLIENT_SECRET`                                            | `api` only                                                                                               | 90 days        | [Entra](#entra-client-secret)                    |
| `tracker_app`, `tracker_migrator` and `tracker_backup` passwords | `DATABASE_URL` (`api`, `worker`); `MIGRATION_DATABASE_URL` (`migrate`); `BACKUP_DATABASE_URL` (`backup`) | 90 days        | [Database](#database-role-passwords)             |
| `files` bucket keys                                              | `api`, `worker` (read/write); `backup` (read-only)                                                       | 90 days        | [Bucket keys](#bucket-keys)                      |
| `backups` bucket keys (`BACKUP_S3_*`)                            | `migrate`, `backup`                                                                                      | 90 days        | [Bucket keys](#bucket-keys)                      |
| `ANTHROPIC_API_KEY`                                              | `worker` only, and only while the flag is on                                                             | 90 days        | [Anthropic](#anthropic-key)                      |
| `RAILWAY_TOKEN`                                                  | GitHub Environment secret, `staging` and `production`                                                    | 90 days        | [Railway token](#railway-token)                  |
| GHCR credentials                                                 | Railway, source settings of every image service                                                          | With the token | [GHCR](#ghcr-credentials)                        |
| `LOG_PSEUDONYM_SALT`                                             | `api`                                                                                                    | On suspicion   | Changes every log pseudonym; no routine rotation |
| `OTEL_EXPORTER_OTLP_HEADERS`                                     | `api`, `worker`, once a backend exists                                                                   | Per vendor     | Create, replace, revoke                          |

Also rotate any secret on: a person with access leaving, a suspected leak (a log, a screenshot, a chat), or a
vendor notice. Put each expiry in the shared calendar 14 days ahead, and write every rotation in the operations log
with the date, who, and the evidence line below.

## Entra client secret

Entra allows two secrets at once, so this has no downtime.

1. Entra admin centre, the environment's app registration, Certificates and secrets: new secret, expiry 90 days at most.
   Copy it straight into the password manager.
2. Railway, `api`, Variables: replace sealed `ENTRA_CLIENT_SECRET`; redeploy `api` from the dashboard.
3. Verify: sign in with a real account, and `authn_success` appears in the logs. A failure shows `authn_exchange_failed`
   ([auth-failure-spike](auth-failure-spike.md)): put the old secret back (still valid) and retry.
4. Delete the old secret in Entra only after step 3 passes.

## Database role passwords

Re-running `bootstrap-cli` resets **all three** passwords at once ([database](database.md)), so connections made with the
old ones fail from that moment until each service has the new URLs. Do it in a quiet window (Perth evening).

1. Generate three new 16+ character passwords into the password manager. Stage the new sealed URLs: `DATABASE_URL` on
   `api` and `worker` (`tracker_app`), `MIGRATION_DATABASE_URL` on `migrate` (`tracker_migrator`) and
   `BACKUP_DATABASE_URL` on `backup` (`tracker_backup`), without deploying.
2. Confirm before running: the environment, and that the staged values are in all four services. Enable the Postgres TCP
   proxy and run `bootstrap-cli` with the three new passwords (`TRACKER_APP_PASSWORD`, `TRACKER_MIGRATOR_PASSWORD`,
   `TRACKER_BACKUP_PASSWORD`; `bootstrap complete`); disable the proxy.
3. Redeploy `api`, `worker`, `backup` and `migrate` from the dashboard right away (`migrate` runs, finds nothing pending).
4. Verify: `/api/readyz`, a sign-in, an upload, and that the next `backup` run succeeds
   ([backup-failed](backup-failed.md) shows how to read it). Expect a few minutes of errors in between.

## Bucket keys

Railway issues credentials per bucket. Whether two key pairs can be valid at once is unverified: if not, rotating
interrupts that bucket until the variables are updated, so have them ready.

1. Create the new key in Railway for the bucket; store it. For `files` that is `S3_ACCESS_KEY_ID` and
   `S3_SECRET_ACCESS_KEY` on `api` and `worker` (read/write) and a separate read-only pair on `backup`. For `backups`
   it is `BACKUP_S3_ACCESS_KEY_ID` and `BACKUP_S3_SECRET_ACCESS_KEY` on `migrate` and `backup`.
2. Set the sealed variables and redeploy those services. Keep `backups` write keys away from `api` and `worker`.
3. Verify: `/api/readyz` (checks the `files` bucket), an upload and a download, and a manual backup run. Then revoke the old
   key. Update the keys held in your S3 client profiles ([backup-and-restore](backup-and-restore.md)).

## Anthropic key

Only when `FEATURE_AI_STAMP_READING` is on. New key in the Anthropic console; set sealed `ANTHROPIC_API_KEY` on `worker`;
redeploy; confirm a stamp reading succeeds in staging (`kr.ai.stamp_reading{result="read"}`); revoke the old key.
A leaked key is revoked first and rotated second: the feature falls back to the text rule meanwhile, or switch the flag
off ([deploy-and-rollback](deploy-and-rollback.md)).

## Railway token

A project token per environment, stored as the `RAILWAY_TOKEN` secret of the matching GitHub Environment.

1. Railway project settings, Tokens: create a token for the one environment; store it.
2. GitHub, Settings, Environments, that environment, Secrets: replace `RAILWAY_TOKEN`.
3. Verify with `deploy.yml` (`workflow_dispatch`, the tag already running): it redeploys the same digests and the script
   asks Railway which environment the token belongs to, so a wrong-environment token fails at once. Then delete the old
   token in Railway.

## GHCR credentials

The images are private. Railway holds a GitHub personal access token with `read:packages`, owned by a KR machine account,
in the source settings of each image service (`clamav`, `migrate`, `api`, `worker`, `web`, `backup`).

1. Create a new token for the machine account, scope `read:packages` only; store it.
2. Replace it in every service's source registry credentials.
3. Verify by redeploying one service from the dashboard and reading that the image pulled. Revoke the old token.

## Invalidate every session

After a leaked secret that could mint sessions, a compromised admin, or any time KR asks. Everyone signs in again, which
with Entra single sign-on is usually one click. Read-only session first, then the change
([README](README.md#a-read-only-sql-session)).

```sql
SELECT count(*) FROM tracker.sessions WHERE revoked_at IS NULL AND absolute_expires_at > now();
```

Confirm before running: the environment, the count is plausible (about the number of signed-in people), and KR approved.
For one person, disable the user in `/admin/users` instead (it revokes their sessions).

```sql
BEGIN;
UPDATE tracker.sessions SET revoked_at = now(), revoked_reason = 'admin'
WHERE revoked_at IS NULL AND absolute_expires_at > now();
INSERT INTO tracker.audit_events (actor_type, action, entity_type, request_id)
VALUES ('system', 'session.revoked_all', 'session', 'operator:<ticket>');
-- the UPDATE count must equal the SELECT above; then COMMIT; otherwise ROLLBACK;
```

## Evidence line for the operations log

`<date> <environment> rotated <secret> by <name>; verified by <check>; old value revoked <yes/no>; next due <date>.`
