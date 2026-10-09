<!-- managed-by: agentic-playbook v1.0.0 | profile: backend-node | adds to root AGENTS.md; may tighten, never loosen -->

# AGENTS.md — services/api (Node.js / TypeScript service)

## Commands (run in this directory)

| Purpose                  | Command                                                                                                 |
| ------------------------ | ------------------------------------------------------------------------------------------------------- |
| Dev                      | `pnpm dev`                                                                                              |
| Full gate                | `pnpm verify` (= lint + typecheck + test:unit + test:integration + test:contract + build)               |
| Unit                     | `pnpm test:unit` (Vitest; no I/O)                                                                       |
| Integration              | `pnpm test:integration` (Vitest + Testcontainers Postgres; Docker required, or TEST_DATABASE_ADMIN_URL) |
| Contract                 | `pnpm test:contract` (validates responses against `packages/contracts/openapi.yaml`)                    |
| Mutation (changed files) | `pnpm test:mutation`                                                                                    |
| New migration            | `pnpm --filter @kr/db db:migration:new <name>` then `pnpm --filter @kr/db db:migration:lint`            |
| Regenerate API document  | `pnpm openapi:generate` (root)                                                                          |

## Structure

- BE-1. Layers: `src/http/` (routes, request parsing, response mapping) → `src/domain/` (business logic, pure, no I/O imports) → `src/data/` (repositories, SQL). Domain code must not import from `http/` or `data/`; depend on interfaces.
- BE-2. Configuration is parsed once in `src/config.ts` with zod at startup; the process exits on invalid config. No `process.env` access elsewhere.

## API

- BE-3. `packages/contracts` (zod + route registry → `openapi.yaml`) is the contract and is updated in the same PR as the handler. Breaking changes (removed/renamed fields, new required inputs, changed status codes) require a new version path or explicit approval in the brief.
- BE-4. Errors are returned as RFC 9457 `application/problem+json` with a stable `type` URI and the request ID. Throw `AppError` subclasses from `src/platform/errors.ts`; never throw strings or raw `Error` from domain code.
- BE-5. Every handler performs authorisation explicitly (deny by default) and scopes data access by job visibility/owner. A handler without an authz check fails review.
- BE-6. List endpoints paginate (cursor-based, max page size 100).

## Data

- BE-7. SQL only through Kysely (`@kr/db`) or parameterised queries. String-built SQL is forbidden.
- BE-8. Migrations are forward-only and expand/contract: add nullable column → backfill → enforce constraint in a later release; drop in a later release still. Create indexes `CONCURRENTLY`. Set `lock_timeout` ≤ 5s. Migrations are protected from editing once merged.
- BE-9. Repository tests run against real Postgres (Testcontainers). Never mock the database client.

## Reliability

- BE-10. Every outbound call has a timeout (default 2000 ms; S3 10 s; clamd 60 s; Anthropic 30 s), bounded retries with jitter only for idempotent operations, and a circuit breaker for dependencies listed in `src/clients/`.
- BE-11. Handle `unhandledRejection`/`uncaughtException` by logging and exiting; never continue in an unknown state. Graceful shutdown on SIGTERM within 25 s.
- BE-12. Logging: `pino` JSON via `@kr/logger`; include `requestId`, `traceId`; levels: `error` (needs action), `warn` (degraded), `info` (business events), `debug` (off in prod). No personal data, tokens or full request bodies.

<!-- REPO-SPECIFIC:START -->

- Modules live in `src/modules/<name>/{http,domain,data}` and are imported by other modules only via `src/modules/<name>/index.ts` (checked by lint). Register routes only for operations in `packages/contracts` ROUTES; every handler calls an explicit authz helper.
- Job-scoped handlers resolve visibility first and answer 404 for jobs the caller cannot see; write the audit event in the same transaction.
- Date maths and progress rules come from `@kr/workflow` (never reimplement them); inject a Clock.

<!-- REPO-SPECIFIC:END -->
