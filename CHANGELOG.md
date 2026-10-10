# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).
Releases are prepared by release-please from Conventional Commits.

## [Unreleased]

### Added

- Monorepo scaffold (pnpm 11, Node 24, TypeScript strict, ESLint, Prettier, Vitest, Stryker, Playwright, commitlint, lefthook).
- Specifications: product spec, data model, design tokens, ADRs 0001–0014, work package plan.
- `@kr/workflow`: the 10 stages and 46 checkpoints as typed data, pure progress/next-action/alert rules, Perth date helpers.
- `@kr/contracts`: zod API schemas, route registry, permissions matrix and generated OpenAPI 3.1 document.
- `@kr/db`: initial Postgres 17 schema, migration runner, database roles, operations queue and audit helper.
- `@kr/design-tokens`: prototype colours (light and dark), typography and base styles.
- Service skeletons (API, worker, web), CI, security scanning, release and Railway deploy workflows.
- `services/ops` skeleton for the Railway `migrate` (pre-migration backup + migrations, sole holder of the migrator role) and nightly `backup` services.
- Prototype reference (code, CSS, blank-demo screenshots) under `docs/reference/prototype/`.
- Work-package plan as data (`docs/plan/work-packages.json`) with render, check and issue-creation scripts; review decisions in `docs/plan/DECISIONS_LOG.md`.

### Changed

- Deploys are called from the release workflow after images are attested, run services in order (clamav → migrate → api → worker → web → backup) and verify attestations of private GHCR images.
- Schema: OIDC flows are bound to the browser (`auth_flows.browser_binding_hash`), evidence and source files are constrained to their job, job numbers are checked (R15), sessions record `acrs`, files record `scan_attempts`.
- API config: spec rate limits and 100 KB JSON body limit, `HOST` (`::`), `TRUST_PROXY_HOPS` default 1, identity-provider host pinned in staging/production, MFA evidence via `amr` or `acrs`.
- CI: every workspace package gated, per-layer coverage for diff coverage, mutation limited to each package's mutate globs, Prettier check, pinned scanners.

### Fixed

- Local stack (`docker compose --profile stack up`): the S3 mock has a health check and `migrate` waits for it, so a cold start no longer fails with `ECONNREFUSED` on the pre-migration backup.
