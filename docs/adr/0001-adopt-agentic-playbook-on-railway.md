# ADR-0001: Adopt the agentic playbook v1.0.0, hosted on Railway, with vendored workflows

- Status: proposed
- Date: 2026-10-09
- Deciders: KR Surveys (Craig) — pending; drafted for review
- Drafted by: agent claude (orchestrator) for the launching human
- Related: docs/spec/PRODUCT_SPEC.md

## Context

The customer requires the build to follow the attached agentic coding playbook (v1.0.0, status "pilot") "as closely as
possible", except that Azure containers are replaced by Railway.app. The playbook is cloud-agnostic but assumes an
org-level playbook repository (reusable workflows referenced as `OWNER/agentic-playbook/...@<sha>`, sync bot) and a
cloud with OIDC federation, a secret manager and canary deployments. None of these exist for this repository yet.

## Decision

We adopt the playbook as the engineering standard for this repo: root `AGENTS.md`/`CLAUDE.md` from the templates,
required script names in every package, the CI/security/release/deploy/playbook-guard/lessons-digest workflows, the
definition of done, the security checklist, LESSONS.md, ADRs and Conventional Commits with `AI-Agent:` trailers.
Because there is no org playbook repository, the reusable workflows and guard scripts are **vendored** into
`.github/workflows/reusable-*.yml` and `scripts/playbook/` (pinned to playbook v1.0.0, `.playbook-version`); the
`playbook-sync` workflow is omitted until an org playbook repo exists. Railway-specific deviations are recorded in
ADR-0008 (hosting), ADR-0013 (secrets) and ADR-0009 (observability).

## Options considered

| Option                                     | Pros                                        | Cons                                     |
| ------------------------------------------ | ------------------------------------------- | ---------------------------------------- |
| Vendor playbook workflows/scripts (chosen) | Works today; reviewable; SHA-pinned actions | Manual updates when the playbook changes |
| Reference `OWNER/agentic-playbook`         | Central updates                             | Repository does not exist; CI would fail |
| Skip the playbook gates                    | Faster                                      | Violates the customer requirement        |

## Consequences

Vendored files are protected paths (`.github/**`, `scripts/playbook/**` in playbook-guard N6). Updating the playbook
is a human PR. Deviations from the playbook must cite an ADR.

## Compliance check

playbook-guard (N5, N6, N10, budgets, placeholders), CI required checks `ci / verify`, `security / scan`,
`playbook-guard`, `ci / pr-size`.
