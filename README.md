# KR Subdivision Tracker

Web application for KR Surveys (Western Australia) to track subdivision jobs through 10 stages and 46 checkpoints,
shared with clients and architects. It replaces the single-file prototype with a Railway-hosted, Postgres-backed
system that signs users in with Microsoft Entra ID (KR tenant; the first eligible user becomes the administrator).

| Part      | Path                 | What it is                                                                                                   |
| --------- | -------------------- | ------------------------------------------------------------------------------------------------------------ |
| Web       | `apps/web`           | Next.js 16 (App Router) UI + same-origin proxy to the API (`/api/v1/*`)                                      |
| API       | `services/api`       | Fastify 5 modular monolith (auth, jobs, checkpoints, files, conditions, notes, access, audit)                |
| Worker    | `services/worker`    | Background jobs: malware scan, Decision Letter extraction, conformed-date reading, email parsing             |
| Workflow  | `packages/workflow`  | The 46 checkpoints as typed data + pure rules (progress, next actions, alerts, dates)                        |
| Contracts | `packages/contracts` | zod schemas, route registry, permissions → `openapi.yaml`                                                    |
| Database  | `packages/db`        | SQL migrations, Kysely types, migration runner, operations queue, audit helper                               |
| Others    | `packages/*`         | design tokens, config, logger, telemetry, storage (S3), document parsing, mock IdP (tests and local sign-in) |

## Start here

- Product behaviour and exact UI text: [`docs/spec/PRODUCT_SPEC.md`](docs/spec/PRODUCT_SPEC.md)
- Data model: [`docs/spec/DATA_MODEL.md`](docs/spec/DATA_MODEL.md) · Look and feel: [`docs/spec/DESIGN_TOKENS.md`](docs/spec/DESIGN_TOKENS.md)
- Decisions: [`docs/adr/`](docs/adr/) · Delivery plan: [`docs/plan/WORK_PACKAGES.md`](docs/plan/WORK_PACKAGES.md)
- Rules for humans and AI agents: [`AGENTS.md`](AGENTS.md)

## Running and using it

- Operators: [`docs/operations/`](docs/operations/README.md) (index and on-call checklist), the
  [runbooks](docs/runbooks/README.md) (one per alert, plus deploy and rollback, migrations, backup and restore, secrets
  rotation, incident response, first-admin recovery), the [Railway deployment guide](docs/deploy/railway.md),
  [service objectives](docs/slo.md) and [alerts](docs/observability/alerts.md).
- Users: the [user guide](docs/user-guide/README.md), with a [staff guide](docs/user-guide/staff-guide.md) and a
  [client and architect guide](docs/user-guide/client-and-architect-guide.md).

## Local development

Requirements: Node 24 (`.nvmrc`), pnpm 11 (`corepack enable`), Docker.

```sh
pnpm install --frozen-lockfile
grep -vE '^[A-Z0-9_]+=[[:space:]]*(#.*)?$' .env.example > .env   # local values; never commit .env
pnpm db:up                      # Postgres 17, S3 mock, ClamAV
pnpm build                      # workspace packages run from dist/ at runtime
pnpm --filter @kr/db db:bootstrap   # creates the tracker_migrator, tracker_app and tracker_backup roles (reads the three *_PASSWORD values from .env); safe to repeat
pnpm --filter @kr/db db:migrate
pnpm dev                        # web :3000, api :8080, worker health :8081
```

`.env` is copied without the blank optional variables (an empty value is not the same as unset and fails config validation).
The `db:*` and `dev` scripts of `@kr/db`, `@kr/api`, `@kr/worker` and `@kr/web` read the root `.env` themselves; a variable
already set in your shell wins over the file. Sign-in needs a real Entra tenant or the mock IdP (see below).
The container stack (`docker compose --profile stack`) does not read `.env` or your shell for its services: each one lists
the few variables it needs in `docker-compose.yml`, so the database admin, backup and backup bucket credentials in `.env`
reach only the `bootstrap` and `migrate` jobs (set there with the same fake values), never api, worker, web or mock-idp.

A Docker host without IPv6 (no `/proc/net/if_inet6`, some sandboxes and CI containers) cannot bind `::`: run
`KR_STACK_HOST=0.0.0.0 pnpm db:up` (ClamAV) and set `HOST=0.0.0.0` in `.env` (api and worker).

### Signing in locally

Sign-in needs Microsoft Entra ID. Without a tenant use the mock IdP (`packages/mock-idp`): it signs in four synthetic people
(Ada First, the first member to sign in and so the admin, Sam Staff, and the guests Cleo Client and Archie Architect)
without a password and is never deployed.

- **With `pnpm dev`:** in a second terminal run `pnpm --filter @kr/mock-idp start` (it listens on `127.0.0.1:4010` and reads
  the tenant, client and secret from `.env`, so they match the API's), then start the apps pointed at it:
  `ENTRA_AUTHORITY_HOST=http://127.0.0.1:4010 pnpm dev`. Open <http://localhost:3000> and choose a person.
- **With the container stack** (the production images built from this checkout, the `mock-idp` service included):
  `docker compose --profile stack up --build` (prefix `KR_STACK_HOST=0.0.0.0` on a host without IPv6), then open
  <http://localhost:3000>. The API and your browser must use one authority URL, so the stack uses
  `http://mock-idp.localhost:4010`: the service carries that name as a network alias and browsers resolve `*.localhost` to
  your machine. If yours does not, add `127.0.0.1 mock-idp.localhost` to your hosts file.

Quality gate before every push: `pnpm verify` (lint, typecheck, build, unit, integration, contract).
End-to-end tests: `pnpm test:e2e` (Playwright; set `E2E_CHROMIUM_PATH` if browsers cannot be downloaded).

## Hosting

Railway (staging and production environments): `web`, `api`, `worker`, `clamav`, Postgres and a Bucket.
Images are built and attested in GitHub Actions and deployed by digest (`.github/workflows/deploy.yml`, ADR-0008).

## Data

Never put real client data in this repository (fixtures, seeds, tests, docs). Use synthetic data only.
