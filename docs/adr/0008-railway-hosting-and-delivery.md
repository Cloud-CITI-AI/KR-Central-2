# ADR-0008: Hosting on Railway — topology, deploy by attested image digest, and playbook exceptions

- Status: proposed
- Date: 2026-10-09
- Deciders: KR Surveys (Craig) — pending; drafted for review
- Drafted by: agent claude (orchestrator) for the launching human
- Related: docs/spec/PRODUCT_SPEC.md, ADR-0001, ADR-0013, docs/deploy/railway.md

## Context

Customer: deploy on Railway.app, no Azure containers. The playbook's deploy template assumes OIDC cloud login, a cloud
secret manager with workload identity, canary rollouts and IaC scanned by Checkov. Railway provides projects with
environments, services from Docker images or repos, private networking (`*.railway.internal`), managed Postgres,
S3-compatible Buckets, volumes, health checks, pre-deploy commands, PR environments, and project tokens.

## Decision

**Topology** (one Railway project, environments `staging` and `production`; PR environments optional, auth-gated):

| Service    | Source                                                                           | Exposure                                      | Notes                                                                                                |
| ---------- | -------------------------------------------------------------------------------- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `web`      | GHCR image `…/web@sha256:…`                                                      | public domain (e.g. tracker.krsurveys.com.au) | Next.js standalone; `API_INTERNAL_URL=http://api.railway.internal:8080`                              |
| `migrate`  | GHCR image `…/ops@sha256:…` (start `start:migrate`)                              | private only                                  | only holder of `MIGRATION_DATABASE_URL`; pg_dump then migrate; healthy only after success (ADR-0007) |
| `api`      | GHCR image `…/api@sha256:…`                                                      | private only                                  | `tracker_app` URL only (no DDL); health `/readyz`; listens on `::`                                   |
| `worker`   | GHCR image `…/worker@sha256:…`                                                   | private only                                  | health `/healthz` on Railway's `PORT`; listens on `::`                                               |
| `clamav`   | GHCR image built from `infra/clamav/Dockerfile` (official clamav base, pinned)   | private (3310)                                | volume for signatures; `StreamMaxLength`/`MaxFileSize` 60M, `MaxScanSize` 240M; 3 GB RAM             |
| `backup`   | GHCR image `…/ops@sha256:…` (start `start:backup`, Railway cron daily 18:15 UTC) | private only                                  | nightly pg_dump + incremental object copy to the backup bucket; 35-day retention                     |
| `postgres` | Railway Postgres 17                                                              | private                                       | Railway daily backups on; roles per ADR-0007                                                         |
| `files`    | Railway Bucket (S3-compatible)                                                   | private                                       | credentials as service variables; versioning **not** assumed (verify)                                |
| `backups`  | second Railway Bucket                                                            | private                                       | written only by `migrate`/`backup`                                                                   |

Web health check: `/api/healthz` (the web service's own liveness; `/api/readyz` proxies the api's readiness as a bare
status for the smoke tests). The api is never public.

**Delivery**: GitHub Actions builds each image once (release.yml), generates SBOM, scans with Grype, attests provenance and
SBOM, and records digests on the GitHub release. release.yml then **calls** deploy.yml (`workflow_call`, after
`build-and-attest`): a release created with `GITHUB_TOKEN` does not trigger `on: release` in other workflows, and the
digests are only uploaded after the release exists. deploy.yml logs in to GHCR (private images, `packages: read`),
verifies attestations (`gh attestation verify`) and points each Railway service at the exact digest through Railway's
public GraphQL API (`infra/railway/scripts/deploy-images.mjs`) **in order — clamav → migrate → api → worker → web →
backup — waiting for each deployment to be healthy before the next**, so new code never runs against an old schema.
It runs smoke tests and ZAP (staging) and records previous digests for rollback. Railway never builds from source for
staging/production (that would bypass the attestation chain).

**Service settings as code**: Railway reads `railway.json` config-as-code only for services deployed from a repository
(to verify), and these services are deployed from images. The declarative settings therefore live in
`infra/railway/services/<service>.json` (image, start command, health-check path/timeout, restart policy, cron
schedule, replicas) and deploy-images.mjs applies them with `serviceInstanceUpdate` before each deploy and fails if
Railway reports different values. There are no `railway.json` files in the repo.

**Playbook exceptions (accepted risks, review quarterly):**

1. _SE-2 / SC-D1 (no long-lived CI credentials)_: Railway has no OIDC federation. Use a **project token per environment**
   stored as a GitHub **Environment** secret (`RAILWAY_TOKEN`) with required reviewers on `production`, rotated every 90 days
   (SE-4), scoped to one environment.
2. _N9 / §8.4 canary 5→25→50→100 %_: Railway cannot split traffic. Progressive delivery uses **OpenFeature flags** for
   user-visible changes, Railway's health-checked zero-downtime deploys (old deployment serves until the new one is
   healthy), a 10-minute post-deploy **smoke watch** (health, readiness, headers and a latency probe against the SLO
   budgets every 30 s — there is no metrics backend yet, so error-rate/p99 aborts wait for ADR-0009's backend), and
   **automatic rollback** to the previous digests. Migrations are expand-only so rollback never needs a
   down-migration; the `migrate` service's pre-migration `pg_dump` is the recovery point for a bad migration.
3. _SE-1 / CF-2 (secret manager + workload identity)_: see ADR-0013 (Railway sealed variables).
4. _IaC + Checkov_: the Railway service settings (`infra/railway/services/*.json`, applied by the deploy script) are
   not Checkov-scannable; reviewed via CODEOWNERS instead. Hadolint + Grype cover the images.
5. _Backups / object versioning_: Railway Buckets are not assumed to offer versioning. Recovery points are Railway
   Postgres backups, the pre-migration dump and the nightly `backup` service (database dump + incremental object copy
   to a second private bucket, 35-day retention); a quarterly restore drill is in the runbook.
6. _WAF / edge rate limits (API-7, SC-D3)_: Railway has no WAF. Rate limiting and body-size limits are enforced in the API
   (Postgres-backed limiter) and the web proxy; optional Cloudflare in front of the public domain (recommended for
   production; needs KR DNS).
7. _Private registry_: GHCR images are private; Railway needs registry credentials (GitHub PAT with `read:packages`, stored
   in Railway) — rotated with the Railway token.

## Options considered

| Option                                                | Pros                                                 | Cons                                                                 |
| ----------------------------------------------------- | ---------------------------------------------------- | -------------------------------------------------------------------- |
| Deploy attested GHCR digests via Railway API (chosen) | Build once, promote same digest, provenance verified | Script must track Railway's GraphQL API                              |
| Railway GitHub autodeploy from main                   | Zero config                                          | Bypasses attestation, no staging→prod promotion of the same artifact |
| `railway up` from CI                                  | Simple                                               | Builds on Railway from source; same attestation gap                  |

## Consequences

**GitHub plan requirement.** The attestation chain (`actions/attest-build-provenance`, `actions/attest-sbom`, then
`gh attestation verify` in deploy.yml) works for a private repository only on GitHub Enterprise Cloud (public repositories:
every plan). On any other plan with a private repository `build-and-attest` fails and nothing deploys, which is the
intended fail-closed behaviour but a blocker for the first release. Before the first release KR either puts the
organisation on Enterprise Cloud or amends this ADR to replace GitHub attestations with cosign signing and `cosign verify`
(keyless, which records the repository name and workflow identity in Sigstore's public log, or key-based with a KMS key).
The steps are in docs/deploy/railway.md, One-time setup. No fallback is enabled in the workflows.

The deploy script is the single place that talks to Railway; it must be validated against Railway's API in staging first
(open risk). Railway region and plan (Pro for private registry & environments) are KR decisions.

## Compliance check

deploy.yml steps (attestation verify, kill switch `DEPLOYS_FROZEN`, environment approval), quarterly review of the
exceptions in this ADR, token age alert.
