# ADR-0004: Modular monorepo — web, API (modular monolith), worker and shared packages

- Status: proposed
- Date: 2026-10-09
- Deciders: KR Surveys (Craig) — pending; drafted for review
- Drafted by: agent claude (orchestrator) for the launching human
- Related: docs/spec/PRODUCT_SPEC.md

## Context

"Enterprise ready … no monolithic middleware/code base (modular services/packages with clear layering)." Playbook ST-1
(apps/services/packages/infra), ST-2 (http → domain → data, domain has no I/O), one Dockerfile per deployable.
The team is small and Railway charges per service; the domain is one bounded context (subdivision jobs).

## Decision

pnpm monorepo:

- `apps/web` — Next.js UI + thin same-origin proxy (no business logic).
- `services/api` — Fastify HTTP API composed of **modules** (`src/modules/<name>/{http,domain,data}` with a public
  `index.ts`), plus `src/platform` (server, errors, auth hooks, authz, rate limits, audit, idempotency) and
  `src/modules/_shared` (read-model mappers shared by modules).
- `services/worker` — background processing (malware scan, document parsing, AI stamp reading, sweeps), separate
  process and container so untrusted-document parsing never runs in the API process.
- `packages/*` — `workflow` (stages/checkpoints + pure rules), `contracts` (zod + route registry + OpenAPI),
  `db` (migrations, Kysely types, queue, audit), `storage` (S3 + sniffing), `document-parsing`, `config`, `logger`,
  `telemetry`, `design-tokens`, `mock-idp` (tests only).
- `infra/` — Railway config, ClamAV image, deploy scripts.
  Boundaries are enforced by ESLint (`no-restricted-imports` for domain purity, `process.env` only in config.ts) and
  `scripts/check-module-boundaries.mjs` (no deep imports across modules).

## Options considered

| Option                                               | Pros                                                                           | Cons                                                                            |
| ---------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| Modular monolith API + worker (chosen)               | Clear boundaries, one transaction scope, cheap on Railway, easy to split later | Discipline needed (enforced by lint)                                            |
| Microservice per domain                              | Independent deploys                                                            | Distributed transactions, more Railway services, overkill for scale             |
| Next.js full-stack (route handlers + server actions) | One deployable                                                                 | Business logic in the UI tier, harder to test/secure, contradicts "no monolith" |

## Consequences

Modules can be extracted into services later because they only talk through their index. Shared contracts mean API
and web cannot drift. Workspace packages build to `dist` (runtime) and resolve to source via the `@kr/source`
condition for typecheck/tests.

## Compliance check

`pnpm lint` (boundaries), module-ownership unit test, route-table test, PR review checklist.
