# ADR-0003: First eligible user becomes admin; role model

- Status: proposed
- Date: 2026-10-09
- Deciders: KR Surveys (Craig) — pending; drafted for review
- Drafted by: agent claude (orchestrator) for the launching human
- Related: docs/spec/PRODUCT_SPEC.md, ADR-0002

## Context

Requirement: "the FIRST user to sign in becomes admin". Developer note 2 adds a "KR Admin" level that can see fee
proposals while ordinary staff cannot. Clients and architects must see only their own job.

## Decision

- Global roles `admin`, `kr_admin`, `staff`, `external`; job grant roles `client`, `architect`
  (`packages/contracts/src/permissions.ts` is the single capability matrix).
- New users: tenant members (`acct`=0) with an email domain in `KR_STAFF_EMAIL_DOMAINS` → `staff`; everyone else →
  `external`.
- First admin: the first **eligible** (staff-eligible) user to complete sign-in. Inside the sign-in transaction:
  `INSERT INTO system_bootstrap (first_admin_user_id) VALUES ($1) ON CONFLICT DO NOTHING RETURNING ...`; the row's
  constant primary key (`singleton = true`) makes concurrent first sign-ins race-safe — only one transaction gets a row
  and promotes its user. Audited as `user.first_admin_assigned`.
- Guards: an admin cannot change their own role/status; the last active admin cannot be demoted/disabled (409).
- Recovery CLI `promote-admin` for operators (Railway one-off command), audited.

## Options considered

| Option                                   | Pros                           | Cons                                                                 |
| ---------------------------------------- | ------------------------------ | -------------------------------------------------------------------- |
| Singleton bootstrap row (chosen)         | Atomic, DB-enforced, auditable | One extra table                                                      |
| `SELECT count(*) FROM users` then insert | Simple                         | Race condition under concurrent sign-ins                             |
| Advisory lock                            | Works                          | Easy to forget in other paths; lock semantics in pooled connections  |
| Env var `BOOTSTRAP_ADMIN_EMAIL`          | Deterministic                  | Not what the customer asked for (kept as a possible future addition) |
| Admin from Entra app roles               | Central                        | Customer asked for app-managed first admin; adds Entra admin work    |

## Consequences

A guest cannot become admin by signing in first. If KR wants Entra-group-driven roles later, roles can be synced from
app-role claims (new ADR).

## Compliance check

Integration test with concurrent first sign-ins (exactly one admin); unit tests for the capability matrix.
