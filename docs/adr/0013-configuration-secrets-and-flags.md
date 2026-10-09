# ADR-0013: Configuration, secrets and feature flags on Railway

- Status: proposed
- Date: 2026-10-09
- Deciders: KR Surveys (Craig) — pending; drafted for review
- Drafted by: agent claude (orchestrator) for the launching human
- Related: docs/spec/PRODUCT_SPEC.md, ADR-0008

## Context

Playbook CF-1..4 and SE-1..4: twelve-factor config validated once at startup; secrets only in a secret manager via
workload identity; `.env.example` lists every variable; feature flags through OpenFeature with owner and removal date.
Railway has service variables, shared variables and **sealed** variables (write-only in the UI/API), but no workload
identity.

## Decision

- Each service parses env with zod in `src/config.ts` only (`@kr/config`); invalid → variable names logged, exit 1.
- Secrets (`ENTRA_CLIENT_SECRET`, `DATABASE_URL` passwords, `S3_SECRET_ACCESS_KEY`, `ANTHROPIC_API_KEY`,
  `LOG_PSEUDONYM_SALT`) are Railway **sealed** service variables, scoped per environment and per service (least
  privilege: e.g. only the worker gets `ANTHROPIC_API_KEY`, only the api gets `ENTRA_CLIENT_SECRET`). References to
  Railway-managed values (`${{postgres.…}}`) are not used for role URLs (app/migrator roles are separate).
- Rotation every 90 days (calendar reminder + runbook), on staff departure, and on suspicion. Exception to SE-1
  (workload identity) accepted in ADR-0008.
- CI secrets: only `RAILWAY_TOKEN` per GitHub Environment; GHCR uses `GITHUB_TOKEN`.
- Feature flags: OpenFeature server SDK with an environment-variable provider (`FEATURE_*`), listed in `docs/flags.md`
  with owner and removal/review date; flag lint in CI lists flags past their date.
- `.env.example` contains every variable with fake values; a unit test compares config schema keys with it.

## Consequences

No secrets in images, repo, logs or agent context; agents never read `.env*` (X2, `.claude/settings.json` deny rules).

## Compliance check

gitleaks, config/.env.example parity test, quarterly rotation evidence in the runbook.
