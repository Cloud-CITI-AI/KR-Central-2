# Data model

Postgres 17, schema `tracker`. Authoritative DDL: `packages/db/migrations/*.sql` (first: `0001_initial_schema.sql`).
Kysely types: `packages/db/src/schema.ts` (must mirror the DDL). Conventions follow playbook docs/04 §4.3: snake_case,
plural tables, `<entity>_id` foreign keys, `created_at`/`updated_at timestamptz`, enumerations as `text` + `CHECK`
(cheaper to evolve with expand/contract than native enums), UUID primary keys (`gen_random_uuid()`), integer `version`
columns for optimistic concurrency on user-edited rows.

## 1. Entity overview

```
users ──< sessions                     checkpoint_definitions (46 rows, seeded, read-only)
  │                                              │
  │ created_by / updated_by …                    │ key
  ▼                                              ▼
jobs ──< checkpoint_states (46 per job) ──< files (checkpoint slot)
  │                                              │
  ├──< conditions ──< files (evidence)            └── email_messages (1:1 for email files)
  ├──< job_notes
  ├──< access_grants >── users (bound on activation)
  ├──< operations (async work + queue)
  └──< audit_events (append-only; also global events with job_id NULL)
system_bootstrap (singleton: first admin)   auth_flows (OIDC, 10 min)   idempotency_keys   rate_limits
```

## 2. Tables

| Table                    | Purpose                                                | Key columns / constraints                                                                                                                                                                                                                                                                                                               |
| ------------------------ | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `users`                  | People who have signed in (KR members and B2B guests). | `UNIQUE (entra_tenant_id, entra_object_id)`; `role ∈ admin/kr_admin/staff/external`; `status ∈ active/disabled`; `email citext` (nullable — not every Entra account has one); soft "delete" = disable.                                                                                                                                  |
| `system_bootstrap`       | Records the first admin; one row ever.                 | `singleton boolean PK CHECK (singleton)`; `first_admin_user_id UNIQUE`. App role: INSERT/SELECT only.                                                                                                                                                                                                                                   |
| `sessions`               | Server-side sessions.                                  | PK `id_hash` (SHA-256 of the cookie value, 32 bytes); `csrf_token`; `idle_expires_at`, `absolute_expires_at`, `revoked_at`, `revoked_reason`; `amr`, `auth_time` (MFA evidence).                                                                                                                                                        |
| `auth_flows`             | Pending OIDC requests.                                 | PK `state_hash`; `nonce`, `code_verifier`, `return_to` (CHECK same-origin path), `expires_at`. Deleted on use or expiry.                                                                                                                                                                                                                |
| `checkpoint_definitions` | Reference copy of the workflow (46 rows).              | PK `key`; `display_number UNIQUE`, `sort_order UNIQUE`, `stage_key`, `title`, `default_responsibility`, `restricted`. Seeded by migration; test asserts equality with `packages/workflow`.                                                                                                                                              |
| `jobs`                   | One per job.                                           | `job_number citext` unique among active jobs (partial unique index); WAPC dates (`approval_date`, `approval_expiry`, `conformed_date` + `conformed_method` + `conformed_file_id` + `conformed_stamp_text`, `outcome_date`); conditions source; soft delete `deleted_at/by`; `version`. CHECK conformed method present iff date present. |
| `checkpoint_states`      | 46 rows per job, created with the job.                 | PK `(job_id, checkpoint_key)`; `status`, `responsibility` (NULL = unassigned), `kr_note`, `paid_at/by`, `decision`, `decision_comment`, `decided_at/by`, `version`. CHECKs: declined needs a comment; decision and decided_at together. Effective status is computed (never stored).                                                    |
| `conditions`             | WAPC conditions of a job's current extraction.         | `condition_number`, `text`, `agency` (CHECK list), `agency_guessed`, `is_cleared` + `cleared_at/by`, `responsibility ∈ kr/client`, `kr_comment`, `client_comment`, `extraction_id` (operation), `superseded_at` (re-extraction), `version`. Partial unique `(job_id, condition_number) WHERE superseded_at IS NULL`.                    |
| `files`                  | Metadata for every uploaded object.                    | Target: exactly one of (`checkpoint_key` + `slot`) or `condition_id` (CHECK); composite FK to `checkpoint_states`; `storage_key UNIQUE`; `kind` (sniffed), `content_type`, `size_bytes`, `sha256`; `scan_status` + `scan_detail` + `scanned_at`; `uploaded_by/at`; soft delete + `purged_at`.                                           |
| `email_messages`         | Parsed metadata of email files (4.3).                  | PK/FK `file_id`; `parse_status`; subject/from/to/cc/sent_at/body_text; `is_pasted`.                                                                                                                                                                                                                                                     |
| `job_notes`              | Job notes.                                             | `body` (1–5000), `audience ∈ all/surveyor/client` (label only), `author_id`, soft delete.                                                                                                                                                                                                                                               |
| `access_grants`          | Access manager entries.                                | `email citext`, `display_name`, `role ∈ client/architect`, `status ∈ pending/active/revoked`, `user_id` (bound on activation), invitation status/error, `invited_by/at`, `activated_at`, `revoked_at/by`. Partial unique `(job_id, email) WHERE status <> 'revoked'`. CHECK active ⇒ user bound.                                        |
| `operations`             | Async tasks shown to users **and** the worker queue.   | `type ∈ conditions.extract/conformance.read/email.parse/file.scan`, `status ∈ queued/running/succeeded/failed`, `payload jsonb`, `result jsonb`, `error_code/message`, `attempts/max_attempts`, `run_after`, lease `locked_by/locked_until`. Queue index on `run_after WHERE status='queued'`.                                          |
| `idempotency_keys`       | Replay protection for POSTs with `Idempotency-Key`.    | PK `(user_id, key)`; request hash; stored response; swept after 24 h.                                                                                                                                                                                                                                                                   |
| `rate_limits`            | Store for `rate-limiter-flexible` (Postgres).          | `key varchar(255) PK`, `points`, `expire`.                                                                                                                                                                                                                                                                                              |
| `audit_events`           | Append-only audit trail.                               | `bigint identity` PK; `actor_user_id` + `actor_type ∈ user/system` (CHECK consistent); `action` (`entity.verb`), `job_id`, `entity_type`, `entity_id`, `request_id`, `changes jsonb` (`{"field": {"from": …, "to": …}}`). App role: INSERT/SELECT only.                                                                                 |
| `schema_migrations`      | Runner bookkeeping.                                    | `version`, `name`, `checksum`, `applied_at` (created by the runner).                                                                                                                                                                                                                                                                    |

## 3. Indexes (all in 0001)

Partial unique: `jobs(job_number) WHERE deleted_at IS NULL`; `conditions(job_id, condition_number) WHERE superseded_at
IS NULL`; `access_grants(job_id, email) WHERE status <> 'revoked'`. Lookups: `users(email)`, `sessions(user_id) WHERE
revoked_at IS NULL`, `files(job_id, checkpoint_key) WHERE deleted_at IS NULL`, `files(condition_id)`, scan queue
`files(uploaded_at) WHERE scan_status='pending'`, purge `files(deleted_at) WHERE purged_at IS NULL`,
`job_notes(job_id, created_at DESC, id DESC)`, `access_grants(email) WHERE pending`, `access_grants(user_id, job_id)
WHERE active`, operations queue/lease/job, audit by job/actor/time.

## 4. Roles and privileges (ADR-0007, playbook DB-6)

- `tracker_migrator`: owns schema `tracker`; runs migrations (Railway pre-deploy command, `MIGRATION_DATABASE_URL`).
- `tracker_app`: DML only via default privileges; `REVOKE UPDATE, DELETE` on `audit_events` and `system_bootstrap`;
  read-only on `checkpoint_definitions`; `statement_timeout 15s`, `idle_in_transaction_session_timeout 30s`.
- Bootstrap: `node packages/db/dist/bootstrap-cli.js` with the Railway superuser (one-off, operator). Re-run to rotate
  passwords (90 days, SE-4).

## 5. Lifecycle and soft delete

| Entity                                | Delete semantics                                                                                                         |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Job                                   | Archive = `deleted_at` (hidden everywhere; job number reusable). Hard delete only by an operator script after retention. |
| File                                  | Soft delete; object purged by the worker 30 days later (`purged_at`).                                                    |
| Condition                             | Superseded on re-extraction (rows kept for audit; evidence files soft-deleted with them).                                |
| Note                                  | Soft delete.                                                                                                             |
| Grant                                 | `status = revoked` (kept for audit).                                                                                     |
| User                                  | `status = disabled` (sessions revoked).                                                                                  |
| Session / auth flow / idempotency key | Hard-deleted by sweeps after expiry (+7 days for sessions).                                                              |

## 6. Transactions and invariants enforced in code

- Job creation inserts the job and its 46 `checkpoint_states` (default responsibilities from the definition) plus an
  audit event in one transaction.
- Every mutation writes its audit event in the same transaction (`changes` = changed fields only; never file contents or
  tokens).
- Versioned updates: `UPDATE … SET …, version = version + 1 WHERE id = $1 AND version = $2` → 0 rows ⇒ 412.
- Mark paid: `paid_at = now(), paid_by, status = 'completed'`; undo: `paid_at = NULL, paid_by = NULL, status = 'not_completed'`.
- Setting `conformed_date` (manual) sets `conformed_method='manual'`, clears file/stamp text, sets `outcome_date = +90`
  unless provided.
- Re-extraction: `UPDATE conditions SET superseded_at = now() WHERE job_id = $1 AND superseded_at IS NULL`, soft-delete
  their evidence files, insert new rows, set `jobs.conditions_source_file_id/extracted_at` (+ approval dates if found).
- Grant activation at sign-in: `UPDATE access_grants SET status='active', user_id=$u, activated_at=now() WHERE
lower(email)=lower($email) AND status='pending' AND job not archived`.
- First admin: see ADR-0003.
- Queue claim: `UPDATE operations SET status='running', locked_by=$w, locked_until=now()+lease, attempts=attempts+1,
started_at=coalesce(started_at, now()) WHERE id = (SELECT id FROM operations WHERE status='queued' AND run_after <=
now() ORDER BY run_after, created_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`; expired leases are re-queued with
  exponential back-off until `max_attempts`, then `failed`.

## 7. Data types at the boundary

`date` ↔ `'yyyy-mm-dd'` string (pg type parser), `timestamptz` ↔ `Date` (API serialises ISO 8601 UTC), `bigint` ↔
string, `bytea` ↔ Buffer, `citext` ↔ string.

## 8. Migration rules (DB-3..5) and Squawk

Forward-only, expand/contract, one concern per file, `lock_timeout 5s` (set by runner and at the top of each file),
`CREATE INDEX CONCURRENTLY` in `-- migrate:no-transaction` files for existing tables, backfills as worker jobs, drops
only one release after reads stop. `pnpm --filter @kr/db db:migration:lint` runs Squawk with `.squawk.toml`:
excluded rules and why — `prefer-robust-stmts` (each file runs once in a transaction under an advisory lock),
`prefer-bigint-over-int`/`-smallint` (versions/counters/46-row sort order), `prefer-text-field` (rate-limiter table
contract). `0001` additionally excludes `adding-foreign-key-constraint` because its FKs are added to tables created in
the same transaction. Applied migrations are immutable (checksum check).

## 9. Example (synthetic) shapes

```json
{
  "jobNumber": "S-0001",
  "address": "1 Example Street, Testville",
  "clientName": "Sample Developments Pty Ltd",
  "subdivisionType": "Survey-Strata",
  "approvalDate": "2026-03-02",
  "approvalExpiry": "2029-03-02"
}
```

Test factories (`services/api/test/factories.ts`, WP-01) generate synthetic jobs, users and conditions with
`@faker-js`-style deterministic seeds; the prototype's example job is never used (TD-1).
