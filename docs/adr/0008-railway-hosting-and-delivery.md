# ADR-0008: Hosting on Railway — topology, deploy by attested image digest, and playbook exceptions

- Status: proposed
- Date: 2026-10-09
- Deciders: KR Surveys (Craig) — pending; drafted for review
- Drafted by: agent claude (orchestrator) for the launching human
- Related: docs/spec/PRODUCT_SPEC.md, ADR-0001, ADR-0013, docs/runbooks/deploy-railway.md

## Context

Customer: deploy on Railway.app, no Azure containers. The playbook's deploy template assumes OIDC cloud login, a cloud
secret manager with workload identity, canary rollouts and IaC scanned by Checkov. Railway provides projects with
environments, services from Docker images or repos, private networking (`*.railway.internal`), managed Postgres,
S3-compatible Buckets, volumes, health checks, pre-deploy commands, PR environments, and project tokens.

## Decision

**Topology** (one Railway project, environments `staging` and `production`; PR environments optional, auth-gated):

| Service    | Source                                                                         | Exposure                                      | Notes                                                                       |
| ---------- | ------------------------------------------------------------------------------ | --------------------------------------------- | --------------------------------------------------------------------------- |
| `web`      | GHCR image `…/web@sha256:…`                                                    | public domain (e.g. tracker.krsurveys.com.au) | Next.js standalone; `API_INTERNAL_URL=http://api.railway.internal:8080`     |
| `api`      | GHCR image `…/api@sha256:…`                                                    | private only                                  | pre-deploy command `node packages/db/dist/migrate-cli.js`; health `/readyz` |
| `worker`   | GHCR image `…/worker@sha256:…`                                                 | private only                                  | health `/healthz` on 8081                                                   |
| `clamav`   | GHCR image built from `infra/clamav/Dockerfile` (official clamav base, pinned) | private (3310)                                | volume for signatures; freshclam updates                                    |
| `postgres` | Railway Postgres 17                                                            | private                                       | daily backups; roles per ADR-0007                                           |
| `files`    | Railway Bucket (S3-compatible)                                                 | private                                       | versioning on; credentials as service variables                             |

**Delivery**: GitHub Actions builds each image once (release.yml), generates SBOM, scans with Grype, attests provenance and
SBOM, and records digests on the GitHub release. deploy.yml verifies attestations (`gh attestation verify`) and points
each Railway service at the exact digest through Railway's public GraphQL API (`infra/railway/scripts/deploy-images.mjs`),
waits for healthy deployments, runs smoke tests and ZAP (staging), and records previous digests for rollback. Railway never
builds from source for staging/production (that would bypass the attestation chain).

**Playbook exceptions (accepted risks, review quarterly):**

1. _SE-2 / SC-D1 (no long-lived CI credentials)_: Railway has no OIDC federation. Use a **project token per environment**
   stored as a GitHub **Environment** secret (`RAILWAY_TOKEN`) with required reviewers on `production`, rotated every 90 days
   (SE-4), scoped to one environment.
2. _N9 / §8.4 canary 5→25→50→100 %_: Railway cannot split traffic. Progressive delivery uses **OpenFeature flags** for
   user-visible changes, Railway's health-checked zero-downtime deploys (old deployment serves until the new one is
   healthy), a 10-minute post-deploy SLO watch, and **automatic rollback** to the previous digests. Migrations are
   expand-only so rollback never needs a down-migration.
3. _SE-1 / CF-2 (secret manager + workload identity)_: see ADR-0013 (Railway sealed variables).
4. _IaC + Checkov_: Railway config-as-code (`infra/railway/*/railway.json`) is not Checkov-scannable; reviewed via
   CODEOWNERS instead. Hadolint + Grype cover the images.
5. _WAF / edge rate limits (API-7, SC-D3)_: Railway has no WAF. Rate limiting and body-size limits are enforced in the API
   (Postgres-backed limiter) and the web proxy; optional Cloudflare in front of the public domain (recommended for
   production; needs KR DNS).
6. _Private registry_: GHCR images are private; Railway needs registry credentials (GitHub PAT with `read:packages`, stored
   in Railway) — rotated with the Railway token.

## Options considered

| Option                                                | Pros                                                 | Cons                                                                 |
| ----------------------------------------------------- | ---------------------------------------------------- | -------------------------------------------------------------------- |
| Deploy attested GHCR digests via Railway API (chosen) | Build once, promote same digest, provenance verified | Script must track Railway's GraphQL API                              |
| Railway GitHub autodeploy from main                   | Zero config                                          | Bypasses attestation, no staging→prod promotion of the same artifact |
| `railway up` from CI                                  | Simple                                               | Builds on Railway from source; same attestation gap                  |

## Consequences

The deploy script is the single place that talks to Railway; it must be validated against Railway's API in staging first
(open risk). Railway region and plan (Pro for private registry & environments) are KR decisions.

## Compliance check

deploy.yml steps (attestation verify, kill switch `DEPLOYS_FROZEN`, environment approval), quarterly review of the
exceptions in this ADR, token age alert.
