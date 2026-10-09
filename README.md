# KR Subdivision Tracker

Web application for KR Surveys (Western Australia) to track subdivision jobs through 10 stages and 46 checkpoints,
shared with clients and architects. It replaces the single-file prototype with a Railway-hosted, Postgres-backed
system that signs users in with Microsoft Entra ID (KR tenant; the first eligible user becomes the administrator).

| Part      | Path                 | What it is                                                                                       |
| --------- | -------------------- | ------------------------------------------------------------------------------------------------ |
| Web       | `apps/web`           | Next.js 16 (App Router) UI + same-origin proxy to the API (`/api/v1/*`)                          |
| API       | `services/api`       | Fastify 5 modular monolith (auth, jobs, checkpoints, files, conditions, notes, access, audit)    |
| Worker    | `services/worker`    | Background jobs: malware scan, Decision Letter extraction, conformed-date reading, email parsing |
| Workflow  | `packages/workflow`  | The 46 checkpoints as typed data + pure rules (progress, next actions, alerts, dates)            |
| Contracts | `packages/contracts` | zod schemas, route registry, permissions → `openapi.yaml`                                        |
| Database  | `packages/db`        | SQL migrations, Kysely types, migration runner, operations queue, audit helper                   |
| Others    | `packages/*`         | design tokens, config, logger, telemetry, storage (S3), document parsing, mock IdP (tests)       |

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
cp .env.example .env            # fill in local values; never commit .env
pnpm db:up                      # Postgres 17, S3 mock, ClamAV
pnpm build                      # workspace packages run from dist/ at runtime
pnpm --filter @kr/db db:migrate
pnpm dev
```

Quality gate before every push: `pnpm verify` (lint, typecheck, unit, integration, contract, build).
End-to-end tests: `pnpm test:e2e` (Playwright; set `E2E_CHROMIUM_PATH` if browsers cannot be downloaded).

## Hosting

Railway (staging and production environments): `web`, `api`, `worker`, `clamav`, Postgres and a Bucket.
Images are built and attested in GitHub Actions and deployed by digest (`.github/workflows/deploy.yml`, ADR-0008).

## Data

Never put real client data in this repository (fixtures, seeds, tests, docs). Use synthetic data only.
