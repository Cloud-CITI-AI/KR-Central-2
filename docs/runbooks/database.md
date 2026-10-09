# Database access and roles

Who may connect to Postgres, as which role, and how. Source: ADR-0007, `docs/spec/DATA_MODEL.md` section 4,
`packages/db/src/bootstrap.ts`, [deploy/railway.md](../deploy/railway.md) setup step 9.

## Roles

| Role               | Used by                                       | Can                                                                                                    |
| ------------------ | --------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `tracker_app`      | `api`, `worker`; operators for read-only work | DML on schema `tracker`; cannot UPDATE or DELETE `audit_events` or `system_bootstrap`; 15 s statements |
| `tracker_migrator` | `migrate`, `backup` (pg_dump); restores       | Owns schema `tracker`; runs migrations                                                                 |
| superuser          | Railway only; `bootstrap-cli` by an operator  | Everything. Never a service variable, never used by an application                                     |

Passwords live in the team password manager. Sealed Railway variables cannot be read back, so keep the source of truth
there ([secrets-rotation](secrets-rotation.md)).

## Create or reset the roles (bootstrap)

Once per environment at set-up, and to rotate the two passwords. It is idempotent: roles are created or their passwords
reset, the `citext` extension, schema and default privileges are ensured, and data is not touched.

Confirm before running: the connection string is the intended environment's Postgres (check the host and database in
the TCP proxy settings), the TCP proxy was enabled for this task only, and for a rotation the new values are already
staged for every service ([secrets-rotation](secrets-rotation.md)).

```sh
pnpm install --frozen-lockfile && pnpm --filter @kr/db build
SUPERUSER_DATABASE_URL='<postgres URL via the TCP proxy>' \
TRACKER_MIGRATOR_PASSWORD='<16+ characters>' TRACKER_APP_PASSWORD='<16+ characters>' \
  node packages/db/dist/bootstrap-cli.js
```

Expected output: `bootstrap complete`. Read the secrets from your shell's prompt or an environment file outside the
repository, not from the command history. Disable the TCP proxy afterwards and record the date.

## Ground rules

- Diagnosis is a read-only session as `tracker_app` ([README](README.md#a-read-only-sql-session)).
- Data repairs and the operator SQL in [unarchive-job](unarchive-job.md) run as `tracker_app` inside a transaction, so
  the app's own privileges, including the audit table's, still apply.
- `tracker_migrator` is for `migrate`, dumps and restores. Do not use it to edit data.
- The superuser is for bootstrap and for restoring a database onto a new Postgres service. Do not use it for
  diagnosis, and never run DDL on production by hand: schema changes are migrations.
- Never `DROP`, `TRUNCATE` or `DELETE` without a `WHERE` that you have first run as a `SELECT` count; wrap writes in
  `BEGIN;` and `COMMIT;` only after the counts match what you expected.
