# ADR-0007: Postgres 17 with Kysely, forward-only SQL migrations and least-privilege roles

- Status: proposed
- Date: 2026-10-09
- Deciders: KR Surveys (Craig) — pending; drafted for review
- Drafted by: agent claude (orchestrator) for the launching human
- Related: docs/spec/PRODUCT_SPEC.md, docs/spec/DATA_MODEL.md

## Context

Customer: Postgres backend. Playbook: Postgres 17 in tests, SQL through Kysely/Drizzle/Prisma or parameterised queries
(BE-7), forward-only expand/contract migrations linted by Squawk (DB-3), least-privilege roles (DB-6), real-DB
integration tests (BE-9). Railway's Postgres gives a single superuser URL by default.

## Decision

- **Kysely** query builder (typed, parameterised, no runtime codegen or engine binaries); table types hand-written in
  `packages/db/src/schema.ts` mirroring the SQL.
- Migrations are plain SQL files run by a small checksummed runner with an advisory lock, `lock_timeout 5s`, one
  transaction per file (`-- migrate:no-transaction` for `CREATE INDEX CONCURRENTLY`). Squawk in CI.
- Roles: `tracker_migrator` owns schema `tracker` and runs migrations; `tracker_app` has DML only, cannot
  UPDATE/DELETE `audit_events`. Created by an operator with `bootstrap-cli` once per environment; passwords rotated by
  re-running it.
- **Where migrations run** (revised after review): a dedicated private Railway service **`migrate`** (image built from
  `services/ops`) is the only service that holds `MIGRATION_DATABASE_URL`. It is deployed before the api; on start it
  takes a `pg_dump` to the backup bucket when migrations are pending, applies them, and only then reports healthy, so
  the deploy script gates the api on it. A Railway _pre-deploy command_ on the api was rejected: it runs inside the api
  service with the api's variables, which would hand the running API the DDL role and defeat DB-6.
- Enumerations as text + CHECK; UUID keys; `version` columns for optimistic concurrency; soft delete where users expect
  "remove" to be recoverable.
- Tests: Testcontainers `postgres:17-alpine`; when Docker is unavailable `TEST_DATABASE_ADMIN_URL` points at a local
  Postgres 17 and each run gets a fresh database.

## Options considered

| Option                           | Pros                                                  | Cons                                                                        |
| -------------------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------- |
| Kysely + SQL migrations (chosen) | SQL visible to Squawk/reviewers, typed queries, small | Types maintained by hand (tested)                                           |
| Prisma                           | Generated types, migrations                           | Engine binaries, migration SQL less controllable, extra dependency category |
| Drizzle                          | Typed schema in TS                                    | Generated SQL; less mature migration control for expand/contract            |

## Consequences

Schema changes touch three places: migration SQL, `schema.ts`, and (if reference data) the workflow seed test.

## Compliance check

Integration tests (seed = workflow, app role cannot DDL/UPDATE audit), Squawk, PR template migration plan.
