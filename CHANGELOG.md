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
