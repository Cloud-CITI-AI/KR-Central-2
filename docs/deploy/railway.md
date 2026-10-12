# Railway deployment guide

Owner: KR Surveys platform team. Source: ADR-0008 (topology and delivery), ADR-0013 (configuration and secrets),
ADR-0007 (database roles), ADR-0011 (files and malware scanning), PRODUCT_SPEC section 14. Deploys happen only in
`.github/workflows/deploy.yml`; nobody (and no agent) runs the `railway` CLI against staging or production to deploy.

This guide has two halves. This half is one-time setup, per-service variables and how the pipeline drives Railway. The
second half (verifying proxy hops, the Entra app registration, go-live checks, bucket findings, routine operations) starts at
[Verifying X-Forwarded-For handling](#verifying-x-forwarded-for-handling-in-staging).

## What is in the repository

| Path                                          | Purpose                                                                              |
| --------------------------------------------- | ------------------------------------------------------------------------------------ |
| `infra/railway/services/<service>.json`       | Declared settings of each Railway service (validated by `service.schema.json`)       |
| `infra/railway/scripts/deploy-images.mjs`     | Applies the settings and an image digest per service, deploys in order, health-gated |
| `infra/railway/scripts/smoke.mjs`             | Post-deploy checks: health, readiness, sign-in headers, latency, `--watch-minutes`   |
| `.github/workflows/release.yml`, `deploy.yml` | Build, attest and record digests; promote staging then production                    |
| `node --test infra/railway/`                  | Tests for all of the above (mocked Railway; nothing talks to a real project)         |

## Topology

One Railway project with two environments, `staging` and `production` (PR environments are optional and must be
authentication-gated). Service names in Railway must equal the names below: the deploy script finds services by name.

| Service    | Source                            | Exposure               | Listens (set `PORT`) | Health check (settings file)   |
| ---------- | --------------------------------- | ---------------------- | -------------------- | ------------------------------ |
| `clamav`   | GHCR `clamav` image               | private, TCP 3310      | 3310                 | none (TCP only)                |
| `migrate`  | GHCR `ops` image, `start:migrate` | private                | 8082                 | `/healthz`, 600 s              |
| `api`      | GHCR `api` image                  | private (never public) | 8080                 | `/readyz`, 60 s                |
| `worker`   | GHCR `worker` image               | private                | 8081                 | `/healthz`, 60 s               |
| `web`      | GHCR `web` image                  | public domain          | 3000                 | `/api/healthz`, 60 s           |
| `backup`   | GHCR `ops` image, `start:backup`  | private, cron          | none                 | none (cron, `15 18 * * *` UTC) |
| `postgres` | Railway Postgres 17               | private                | 5432                 | Railway's own                  |
| `files`    | Railway Bucket                    | private                | n/a                  | n/a                            |
| `backups`  | Railway Bucket (second)           | private                | n/a                  | n/a                            |

The cron schedule 18:15 UTC is 02:15 in Perth (UTC+8, no daylight saving). No service sleeps and each runs one replica;
the settings files record both so a dashboard edit shows up as drift on the next deploy.

## One-time setup (a human operator, per environment)

1. **Project and environments.** Create the project, then the `staging` and `production` environments. Choose the region
   with KR (PRODUCT_SPEC section 14 prefers Asia-Pacific); the plan must be Pro or above (private registry, environments).
2. **Postgres 17.** Add the Railway Postgres service on major version 17 and turn **Railway backups ON** (daily, plus the
   weekly/monthly options your plan offers). Record the backup schedule in the operations log. The nightly `backup` service and
   the pre-migration dump are additional recovery points, not replacements.
3. **Buckets.** Create two Railway Buckets per environment: `files` (uploads; read/write for `api` and `worker`) and
   `backups` (written only by `migrate` and `backup`). For each, copy the endpoint, region, bucket name and access keys.
   `backup` also needs **read-only** keys for `files` (Railway issues credentials per bucket: create a read-only credential for
   it if your plan allows, otherwise record the exception in ADR-0008 review). See [Bucket findings](#bucket-findings).
4. **Services.** Add `clamav`, `migrate`, `api`, `worker`, `web` and `backup` as **Docker image** services (any placeholder
   image such as `ghcr.io/<org>/<repo>/api:latest` is replaced by the first deploy). Names must match exactly. Do not connect a
   GitHub repository to any of them: Railway must never build from source for staging or production.
5. **GHCR pull credentials.** The images are private. In each service's source settings add registry credentials for
   `ghcr.io` using a GitHub personal access token (fine-grained or classic with `read:packages`) held by a KR machine
   account; rotate it with the Railway token (90 days). The `RAILWAY_TOKEN` and this PAT are the only long-lived credentials.
6. **Private networking.** Services reach each other at `<service>.railway.internal`. Railway documents that environments
   created after 2025-10-16 resolve to IPv4 and IPv6, older ones to IPv6 only, so every service listens on `::` (the images set
   `HOST=::` and `HOSTNAME=::`; set `HOSTNAME=::` on `web` as a service variable too, because container runtimes override the
   image's `HOSTNAME`). Use `http://`, not `https://`, for private URLs. Verify in staging that the health checks pass; if a
   check fails only with `::`, test `0.0.0.0` once to isolate the cause and record the result here (community reports differ).
7. **Domains.** Give only `web` a public domain (for example `tracker.krsurveys.com.au`, CNAME at KR's DNS). Never add a
   domain to `api`, `worker`, `migrate`, `backup`, `clamav` or Postgres. Optional but recommended for production: Cloudflare in
   front of the domain for WAF and edge rate limits (ADR-0008 exception 6).
8. **clamav resources.** Mount a volume at `/var/lib/clamav` and give the service 2 to 3 GB of memory (see
   `infra/clamav/README.md`). The first start downloads about 200 MB of signatures; allow a few minutes. It has no HTTP health
   check, so the deploy is "healthy" once the container runs; the `worker` retries scans of files that arrive before clamd is ready.
9. **Database roles (run once per environment, by a human).** Create the roles and schema with `bootstrap-cli`, which needs a
   Postgres superuser URL and so must never be a service variable. From a workstation with the repository checked out:
   `pnpm install --frozen-lockfile && pnpm --filter @kr/db build`, then
   `SUPERUSER_DATABASE_URL=<railway postgres URL, public TCP proxy enabled only for this step> TRACKER_MIGRATOR_PASSWORD=<16+ chars> TRACKER_APP_PASSWORD=<16+ chars> node packages/db/dist/bootstrap-cli.js`
   (expected output: `bootstrap complete`). Disable the public TCP proxy afterwards. Build the two role URLs from the
   private hostname and the passwords you chose. Keep the passwords in the team password manager, not in shell history.
10. **Variables.** Set the variables of the next section on each service (secrets as **sealed** variables), then add the
    GitHub configuration under [Pipeline wiring](#pipeline-wiring).
11. **First deploy** runs through `deploy.yml` (a release tag). `migrate` runs `pg_dump` (nothing to dump on an empty
    database) and applies the migrations; the first admin is the first eligible staff member to sign in (PRODUCT_SPEC 3.3).

## Variables per service

Every variable in `.env.example` appears below (`infra/railway/test/docs.test.mjs` checks this), except `TEST_DATABASE_ADMIN_URL`, which is for tests without Docker only. "Sealed" means a Railway sealed variable (write-only; ADR-0013): all secrets.
Values in `<angle brackets>` come from Railway or KR. Set `NODE_ENV=production` and `APP_ENV=staging` or `production` on every
service. `RELEASE_VERSION` is baked into each image by the build; do not set it. `PORT`, `HOST` and `HOSTNAME` default correctly in
the images except where stated.

**`api`** (the only service with `ENTRA_CLIENT_SECRET`)

| Variable                                                                                                                              | Value                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `PORT`, `HOST`                                                                                                                        | `8080`, `::`                                                                                            |
| `LOG_LEVEL`                                                                                                                           | `info`                                                                                                  |
| `TRUST_PROXY_HOPS`                                                                                                                    | `1` (the BFF hop only; prove it in staging)                                                             |
| `DATABASE_URL` (sealed)                                                                                                               | `postgres://tracker_app:<password>@postgres.railway.internal:5432/<db>`; the **`tracker_app`** role     |
| `DATABASE_SSL`, `DATABASE_POOL_MAX`                                                                                                   | `false` on the private network (`true` if the URL requires TLS), `10`                                   |
| `PUBLIC_BASE_URL`                                                                                                                     | `https://<web domain>` (https is enforced outside local)                                                |
| `ENTRA_TENANT_ID`, `ENTRA_CLIENT_ID`                                                                                                  | from the app registration                                                                               |
| `ENTRA_CLIENT_SECRET` (sealed)                                                                                                        | app registration client secret, rotated at most every 90 days                                           |
| `ENTRA_AUTHORITY_HOST`                                                                                                                | `https://login.microsoftonline.com` (anything else fails startup in staging/production)                 |
| `KR_STAFF_EMAIL_DOMAINS`                                                                                                              | `krsurveys.com.au`                                                                                      |
| `SESSION_IDLE_MINUTES`, `SESSION_ABSOLUTE_HOURS`                                                                                      | `120`, `12`                                                                                             |
| `LOG_PSEUDONYM_SALT` (sealed)                                                                                                         | random, at least 16 characters, different per environment                                               |
| `REQUIRE_MFA_FOR_ADMIN`                                                                                                               | `true`                                                                                                  |
| `ADMIN_MFA_EVIDENCE`, `ENTRA_ADMIN_AUTH_CONTEXT_ID`                                                                                   | `amr` or `acrs` (proved in staging); the context id such as `c1` only for `acrs`                        |
| `RATE_LIMIT_SIGNIN_PER_MINUTE_PER_IP`, `RATE_LIMIT_WRITES_PER_MINUTE`, `RATE_LIMIT_UPLOADS_PER_MINUTE`, `RATE_LIMIT_READS_PER_MINUTE` | `20`, `120`, `30`, `600` (PRODUCT_SPEC section 14)                                                      |
| `JSON_BODY_LIMIT_BYTES`                                                                                                               | `102400`                                                                                                |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` (sealed), `S3_FORCE_PATH_STYLE`                   | the **files** bucket, read/write; `S3_FORCE_PATH_STYLE` per the bucket's addressing (staging proves it) |
| `UPLOAD_MAX_BYTES`                                                                                                                    | `52428800`; keep equal on `worker`                                                                      |
| `MALWARE_SCAN_MODE`                                                                                                                   | `required` (`disabled` is refused outside local)                                                        |
| `FEATURE_AI_STAMP_READING`, `FEATURE_ENTRA_GUEST_INVITES`                                                                             | `false` until enabled per `docs/flags.md`                                                               |
| `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS` (sealed)                                                                  | empty until KR approves a backend (ADR-0009, X7)                                                        |

**`worker`**

| Variable                                                                                                            | Value                                                                                 |
| ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `PORT`, `HOST`                                                                                                      | `8081`, `::` (health endpoint only)                                                   |
| `DATABASE_URL` (sealed), `DATABASE_SSL`                                                                             | the **`tracker_app`** role, as on `api`                                               |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` (sealed), `S3_FORCE_PATH_STYLE` | the files bucket, as on `api`                                                         |
| `MALWARE_SCAN_MODE`                                                                                                 | `required`                                                                            |
| `CLAMAV_HOST`, `CLAMAV_PORT`, `CLAMAV_TIMEOUT_MS`                                                                   | `clamav.railway.internal`, `3310`, `60000`                                            |
| `CLAMAV_STREAM_MAX_BYTES`, `UPLOAD_MAX_BYTES`                                                                       | `62914560` (= clamd `StreamMaxLength` 60M), `52428800`; upload must not exceed stream |
| `SCAN_ERROR_MAX_RETRIES`                                                                                            | `3`                                                                                   |
| `FEATURE_AI_STAMP_READING`, `ANTHROPIC_API_KEY` (sealed), `ANTHROPIC_MODEL`, `ANTHROPIC_TIMEOUT_MS`                 | `false` and unset until KR enables it; the key exists **only** on `worker`            |
| `WORKER_CONCURRENCY`, `WORKER_POLL_INTERVAL_MS`, `WORKER_LEASE_SECONDS`, `PDF_MAX_PAGES`                            | `2`, `1000`, `300`, `60`                                                              |
| `LOG_LEVEL`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS` (sealed)                                   | as on `api`                                                                           |

**`web`**

| Variable           | Value                                                      |
| ------------------ | ---------------------------------------------------------- |
| `PORT`, `HOSTNAME` | `3000`, `::` (set `HOSTNAME` explicitly; see setup step 6) |
| `API_INTERNAL_URL` | `http://api.railway.internal:8080`                         |
| `FEEDBACK_URL`     | optional "Send feedback" footer link; empty hides it       |

**`migrate`** (the only service with `MIGRATION_DATABASE_URL` in the target design; see the known discrepancy below)

| Variable                                                                                                                                               | Value                                                                        |
| ------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| `PORT`, `HOST`                                                                                                                                         | `8082`, `::` (the `/healthz` endpoint that Railway gates the deployment on)  |
| `MIGRATION_DATABASE_URL` (sealed), `DATABASE_SSL`                                                                                                      | `postgres://tracker_migrator:<password>@postgres.railway.internal:5432/<db>` |
| `BACKUP_S3_ENDPOINT`, `BACKUP_S3_REGION`, `BACKUP_S3_BUCKET`, `BACKUP_S3_ACCESS_KEY_ID`, `BACKUP_S3_SECRET_ACCESS_KEY` (sealed), `S3_FORCE_PATH_STYLE` | the **backups** bucket, write access                                         |
| `BACKUP_RETENTION_DAYS`, `PG_DUMP_PATH`, `LOG_LEVEL`                                                                                                   | `35`, `/usr/bin/pg_dump` (baked into the image), `info`                      |

**`backup`**

| Variable                                                                                                            | Value                                                  |
| ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `BACKUP_*` (as on `migrate`), `BACKUP_RETENTION_DAYS`, `PG_DUMP_PATH`, `LOG_LEVEL`                                  | the backups bucket and settings, as on `migrate`       |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` (sealed), `S3_FORCE_PATH_STYLE` | the **files** bucket with **read-only** keys           |
| `MIGRATION_DATABASE_URL` (sealed), `DATABASE_SSL`                                                                   | **required by today's code** (known discrepancy below) |

**Known discrepancy (tracked for the platform team).** ADR-0007 and ADR-0008 say
`MIGRATION_DATABASE_URL` exists only on `migrate`, but `services/ops/src/config.ts` requires it for every ops process and
`backup-service.ts` passes it to `pg_dump`. Until `services/ops` accepts a read-only dump role for `backup` (a change outside
WP-23), `backup` must hold the migrator URL or it fails at start. Never set `MIGRATION_DATABASE_URL` or `SUPERUSER_DATABASE_URL`,
`TRACKER_MIGRATOR_PASSWORD` or `TRACKER_APP_PASSWORD` on `api`, `worker` or `web`; the last three are only for `bootstrap-cli` above.

## Pipeline wiring

Configure these in GitHub (Settings, Environments), once per environment:

| Where                    | Name                             | Value                                                                                   |
| ------------------------ | -------------------------------- | --------------------------------------------------------------------------------------- |
| Environment secret       | `RAILWAY_TOKEN`                  | a Railway **project token** created for that one environment (Project Settings, Tokens) |
| Environment variable     | `STAGING_URL` / `PRODUCTION_URL` | the public https origin the smoke tests and ZAP use                                     |
| `production` environment | required reviewers               | KR staff who are not the person who launched the release; agents are never reviewers    |
| Repository variable      | `DEPLOYS_FROZEN`                 | `true` stops every deploy at its first step; unset or `false` allows deploys            |

### The `release` environment and the release GitHub App

`release.yml` needs a `release` GitHub Environment (Settings, Environments, New environment). Its two jobs use it:
`release-please` (opens and updates the release pull request, tags and creates the release) and `build-and-attest` (pushes
the images to GHCR, attests them and uploads the digests). Settings of the `release` environment:

- **Deployment branches and tags:** selected branches, `main` only. The App key below then exists only for runs on `main`; a
  pull request or a feature branch cannot read it.
- **Required reviewers: none.** The human gate is merging the release pull request (and `production` approval later). A
  reviewer here would block `release-please` on every push to `main`.
- **Variable** `RELEASE_APP_CLIENT_ID` and **secret** `RELEASE_APP_PRIVATE_KEY`, from the App below.

**Why an App.** GitHub starts no `pull_request` workflows for pushes and pull requests made with `GITHUB_TOKEN`. A release
pull request opened with it never receives `ci / verify`, `security / scan` and `playbook-guard`, which the org ruleset
requires, so it can never merge, no tag is created and `build-and-attest` and `deploy` never run. `release-please` therefore
runs with an installation token of a GitHub App (`actions/create-github-app-token`, pinned by SHA in `release.yml`), and the
pull request it opens is a normal pull request whose checks start.

Create the App once (an organisation owner, GitHub, Settings, Developer settings, GitHub Apps, New GitHub App):

1. Name it for the repository (for example `kr-central-2-release`), homepage URL the repository, **Webhook: inactive**,
   installable by **this organisation only**.
2. Repository permissions: **Contents** read and write, **Pull requests** read and write, **Issues** read and write
   (release-please labels its pull requests), Metadata read. Nothing else; no account or organisation permissions.
3. Create the App, note its **Client ID** (starts with `Iv`), generate a **private key** (a `.pem` file) and install the App
   on **this repository only**.
4. Save the Client ID as the `release` environment **variable** `RELEASE_APP_CLIENT_ID` and the whole `.pem` text as the
   `release` environment **secret** `RELEASE_APP_PRIVATE_KEY`. Delete the `.pem` from the workstation afterwards (X2:
   it is never committed, pasted or logged).
5. If the org ruleset restricts who may push or open pull requests, add the App to the bypass list **only** for what
   release-please needs (create and update `release-please--branches--*`, create tags); it needs no bypass of the required
   checks, which now run on its pull request. `playbook-guard` treats a `release-please--branches--*` pull request opened by a
   bot of this repository as a release pull request (no agent label or template; it may change only `CHANGELOG.md`,
   `package.json` and `.release-please-manifest.json`).

Settings, Actions, General, Workflow permissions: with the App token the box
**Allow GitHub Actions to create and approve pull requests** is **not needed** and should stay off (least privilege). It
matters only if someone switches `release-please` back to `GITHUB_TOKEN`, which brings back the problem above even with the
box ticked: the checks would still not run.

Rotate `RELEASE_APP_PRIVATE_KEY` every 90 days like the other long-lived credentials (generate a new key, update the
secret, delete the old key) and when anyone who saw it leaves. Deleting the App's installation stops releases at once.

Rotate `RAILWAY_TOKEN` every 90 days (create the new token, update the secret, delete the old one) and when anyone with
access leaves. The token only reaches the deploy steps.

The deploy steps, as `deploy.yml` runs them:

```
gh release download "$TAG" -p 'image-*.txt'                       # one digest reference per image, written by release.yml
gh attestation verify "oci://$(cat image-api.txt)" ...            # provenance verified before anything is deployed
node infra/railway/scripts/deploy-images.mjs --environment staging \
  --services "clamav migrate api worker web backup" --record previous-staging.json
node infra/railway/scripts/smoke.mjs --base-url "$STAGING_URL"                       # staging
node infra/railway/scripts/smoke.mjs --base-url "$PRODUCTION_URL" --watch-minutes 10 # production
node infra/railway/scripts/deploy-images.mjs --environment staging --rollback previous-staging.json   # on failure
```

What `deploy-images.mjs` does, per service in the given order (which must follow clamav, migrate, api, worker, web,
backup so new code never meets an old schema and the api never holds DDL credentials):

1. Reads `image-<image>.txt` (ops for `migrate` and `backup`) and refuses anything that is not `ghcr.io/...@sha256:<digest>`.
2. Sends the settings file and the image as `serviceInstanceUpdate`, reads the instance back and **fails on any difference**
   (drift), for example a health-check path edited in the dashboard.
3. Triggers a deployment and polls it. Healthy is `SUCCESS` (cron services: also `SLEEPING`); `FAILED`, `CRASHED`, `REMOVED`,
   `SKIPPED` and `NEEDS_APPROVAL` fail. The wait is the larger of 600 s or the health-check timeout plus 300 s (override with
   `--timeout-minutes`), polled every 10 s. The six services can wait 65 minutes in all (clamav 10, migrate 15, the others 10
   each), so `deploy.yml` gives the deploy step and the rollback step 75 minutes each and the job 200; the rollback step runs
   on failure **and** cancellation (`infra/railway/test/pipeline.test.mjs` fails if the budgets stop covering the script).
   It stops at the first failing service and names the services not started.
4. `--record <file>` writes each service's current image and settings **before** the first change. `--rollback <file>` puts
   changed services back (same checks), skips services still on their recorded state, and leaves services that had no earlier
   image. A recorded image that is not a `ghcr.io/...@sha256:<digest>` reference (for example the setup placeholder
   `...:latest`) counts as no earlier image: the rollback logs it and leaves that service alone rather than redeploy a tag. Expand-only migrations mean rollback never needs a down-migration; the `migrate` pre-migration dump is the recovery point.
5. `--dry-run` prints the plan without contacting Railway (no token needed). Locally:
   `node infra/railway/scripts/deploy-images.mjs --environment staging --images-dir <dir with image-*.txt> --dry-run`.

Exit codes: 0 done, 1 deployment failed, 2 bad usage. The token is read from `RAILWAY_TOKEN` and never printed. The token
must be scoped to the environment named in `--environment`; the script asks Railway which environment the token belongs to and refuses a mismatch.

## Railway API reference and what is verified

Endpoint `https://backboard.railway.com/graphql/v2`, header `Project-Access-Token: <token>`, JSON bodies. All of it lives in
`infra/railway/scripts/lib/railway-client.mjs`. **Nothing below was verified against a live Railway project**: the sandbox
that wrote this could not reach docs.railway.com, railway.com or station.railway.com, so the shapes come from search-result
summaries of Railway's documentation and forum. The first staging run is the verification; correct this table with what you see
(GraphiQL at `https://railway.com/graphiql` or an introspection query is the source of truth).

| Call                                                                                                                                                                                                                                | Used for                                                   | Status                                                                                                                                                                                     |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Header `Project-Access-Token`                                                                                                                                                                                                       | Project token (account tokens use `Authorization: Bearer`) | Documented by Railway per summaries; one forum report of `Not Authorized` with a project token on some queries: **unverified**                                                             |
| `projectToken { projectId environmentId }`                                                                                                                                                                                          | Which project and environment the token is scoped to       | **Unverified**                                                                                                                                                                             |
| `project(id) { environments { edges { node { id name } } } services { ... } }`                                                                                                                                                      | Environment name check and service ids by name             | **Unverified**                                                                                                                                                                             |
| `serviceInstance(environmentId, serviceId) { source { image } startCommand healthcheckPath healthcheckTimeout restartPolicyType restartPolicyMaxRetries cronSchedule numReplicas sleepApplication latestDeployment { id status } }` | Drift check and record                                     | Field names from the config-as-code reference and forum: **unverified**; `numReplicas` may be superseded by `multiRegionConfig` (a forum thread reports replica scaling not taking effect) |
| `serviceInstanceUpdate(serviceId, environmentId, input)`                                                                                                                                                                            | Apply settings and `source.image`                          | Mutation and `input.source.image` seen in a community script: **unverified**; community reports it may not itself trigger a deployment                                                     |
| `serviceInstanceDeployV2(serviceId, environmentId)`                                                                                                                                                                                 | Trigger the deployment; returns its id                     | Named in Railway's cookbook per summaries; the older `serviceInstanceDeploy` was not used: **unverified**                                                                                  |
| `deployment(id) { id status }`                                                                                                                                                                                                      | Poll health (`SUCCESS`, `FAILED`, `CRASHED`, ...)          | **Unverified**, including whether a cron deployment reaches `SUCCESS` or `SLEEPING`                                                                                                        |

Known risks to check in staging, in this order: (1) the token header works for all calls; (2) `serviceInstanceUpdate`
accepts `null` to clear `startCommand`, health-check and cron fields and does not leave drift on `restartPolicyMaxRetries`
(there is a CLI issue about `ON_FAILURE` retries comparing against null); (3) triggering `serviceInstanceDeployV2` after an
image change deploys the new digest rather than redeploying the old one; (4) the backup cron deployment status;
(5) registry credentials survive an image change. If a call needs a different shape, change `railway-client.mjs` and its test only.

## Verifying X-Forwarded-For handling in staging

The sign-in limit (20 per minute per client IP) and the audit trail depend on the API seeing the real client address.
The chain is: Railway edge, then `web` (which forwards `X-Forwarded-For` exactly as received, never replacing it with its own
socket view; `apps/web/src/lib/bff/headers.ts`), then `api`, where Fastify's `trustProxy` is `TRUST_PROXY_HOPS` (1: the web hop
only). Railway's exact edge behaviour (append or replace, and `X-Real-IP`) is **unverified**; prove it in staging before
production, and again if Railway changes its edge or a CDN is put in front (then the hop count changes).

1. Set `TRUST_PROXY_HOPS=1` on `api` (staging) and sign in once so the session exists.
2. From one machine, send 25 requests to `https://<staging>/api/v1/auth/login` (a public sign-in route; a 302 is a pass for
   one request), each with a different forged header, for example `X-Forwarded-For: 203.0.113.<n>`.
   **Pass:** the request after the 20th answers `429` with `Retry-After`. The limiter keyed on the real address, so forging did
   not help. **Fail:** all 25 pass (the limiter keyed on the forged value: raise or lower `TRUST_PROXY_HOPS` or find the
   header Railway really sets, then repeat).
3. Immediately, from a different network (a phone on mobile data), request the same route once.
   **Pass:** not 429. **Fail:** 429 means every user shares one bucket (the API sees the web service's address, so
   `TRUST_PROXY_HOPS` is too low or `X-Forwarded-For` is not forwarded).
4. Wait a minute and record the result, date and Railway edge behaviour in the operations log.

## Entra app registration checklist

Create **one app registration per environment** (staging and production) in the KR tenant, so redirect URIs and secrets
never mix. Keep the checklist result with the go-live record. ADR-0002 and ADR-0014 are the source of every item.

| #   | Step (Entra admin centre, App registrations)                                                                                                                                                                                                                                              | Done |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| E1  | New registration, **single tenant** ("Accounts in this organizational directory only"). Record the tenant and application (client) IDs for `ENTRA_TENANT_ID` and `ENTRA_CLIENT_ID`.                                                                                                       | [ ]  |
| E2  | Authentication, platform **Web**, redirect URI `https://<web domain>/api/v1/auth/callback`. No localhost or wildcard URIs in production.                                                                                                                                                  | [ ]  |
| E3  | Authentication, **front-channel logout URL** `https://<web domain>/signed-out`. Also register `https://<web domain>/signed-out` as a redirect URI: Entra matches the app's `post_logout_redirect_uri` (`/signed-out`) against registered URIs (confirm at the first sign-out in staging). | [ ]  |
| E4  | Authentication: **implicit grant and hybrid flows off** (neither access nor ID tokens ticked). The app uses the code flow with PKCE and a client secret.                                                                                                                                  | [ ]  |
| E5  | Token configuration, optional claims, **ID** token: add `email`, `acct` and `xms_edov`. Accept the prompt to add the Microsoft Graph `email` permission.                                                                                                                                  | [ ]  |
| E6  | API permissions: delegated `openid`, `profile`, `email` only. Grant admin consent. Add application permission `User.Invite.All` (with admin consent) **only** when `FEATURE_ENTRA_GUEST_INVITES` is turned on (ADR-0014).                                                                 | [ ]  |
| E7  | Certificates and secrets: **one client secret, expiry 90 days at most**, stored as the sealed `ENTRA_CLIENT_SECRET` on `api` only. Never in the repository, CI or chat.                                                                                                                   | [ ]  |
| E8  | Calendar reminders 14 days before expiry. Rotation: create the new secret, update the sealed variable, redeploy `api`, check a sign-in, delete the old secret. Also on departure of anyone who saw it.                                                                                    | [ ]  |
| E9  | Enterprise application: consider **assignment required = yes** with a security group of staff and invited guests (an extra gate in front of the app's own grants). Optional hardening.                                                                                                    | [ ]  |
| E10 | Conditional Access: a policy for this application that **requires MFA** (all users of the app is simplest and gives every admin session `amr` evidence), or an authentication context (for example `c1`) for step-up, with `ADMIN_MFA_EVIDENCE=acrs` and `ENTRA_ADMIN_AUTH_CONTEXT_ID`.   | [ ]  |
| E11 | External collaboration settings: restrict who may invite guests to KR IT. Decide whether email one-time passcode is allowed for clients without Microsoft accounts (open question in ADR-0014).                                                                                           | [ ]  |
| E12 | Cross-tenant access: if guests' home tenants perform MFA, consider trusting their MFA claims so they are not prompted twice. Optional.                                                                                                                                                    | [ ]  |

The authority host stays `https://login.microsoftonline.com`; the API refuses to start in staging or production with any other.

## Go-live checks

Run these in **staging with production-like settings** (`REQUIRE_MFA_FOR_ADMIN=true`, `MALWARE_SCAN_MODE=required`), record the
result and date, and only then enable production. An unproven item blocks go-live.

| #   | Check                           | How                                                                                                                                                                                                                                                                                    | Pass                                                                                          |
| --- | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| G1  | **Admin MFA evidence (`amr`)**  | Sign in as an admin account covered by E10. Open `/admin/users`. Then read the session: `SELECT s.amr, s.acrs, s.auth_time FROM tracker.sessions s JOIN tracker.users u ON u.id = s.user_id WHERE u.email = '<admin email>' ORDER BY s.created_at DESC LIMIT 1;` (run by an operator). | `amr` contains `mfa` and `/admin/users` loads. With `ADMIN_MFA_EVIDENCE=amr` this proves it.  |
| G2  | **Fallback `acrs`**             | If G1 shows an empty `amr` and `/admin/users` answers 403 "Multi-factor sign-in required", create the authentication context, target it with a Conditional Access policy, set `ADMIN_MFA_EVIDENCE=acrs` and `ENTRA_ADMIN_AUTH_CONTEXT_ID=<id>`, redeploy `api`, repeat G1.             | `acrs` contains the context id and the admin pages load.                                      |
| G3  | **No MFA, no admin pages**      | Sign in as an admin without satisfying MFA (a test account excluded from the policy, then removed).                                                                                                                                                                                    | `/admin/users` and `/admin/audit` answer 403 `forbidden`, "Multi-factor sign-in required".    |
| G4  | **Guest email claim**           | Invite a test guest (personal Microsoft account or another tenant), give them a grant on a synthetic job, sign in as the guest.                                                                                                                                                        | The job appears (grant activated from the `email` claim); the user row has `is_guest = true`. |
| G5  | **Unverified email is refused** | If the tenant can produce a guest with `xms_edov=false`, repeat G4 for that guest.                                                                                                                                                                                                     | Redirect to `/sign-in-error?reason=unverified_email` and the grant stays pending.             |
| G6  | **First admin**                 | On the empty staging database, the first staff member to sign in becomes `admin` (PRODUCT_SPEC 3.3).                                                                                                                                                                                   | `/admin/users` loads for them; a guest signing in first does not become admin.                |
| G7  | **Forwarded address**           | The procedure under "Verifying X-Forwarded-For handling in staging".                                                                                                                                                                                                                   | Steps 2 and 3 pass.                                                                           |
| G8  | **Deploy rehearsal**            | Run `deploy.yml` for a staging release (all six services deploy in order, smoke passes). Then force a failure in staging only (a tag whose api image fails its health check) and confirm automatic rollback restores the previous digests.                                             | Order, drift detection, rollback and smoke all behave as in `infra/railway/test`.             |
| G9  | **Railway API shapes**          | Compare every row of "Railway API reference and what is verified" with the first real run and update the table and `railway-client.mjs`.                                                                                                                                               | Table has no "unverified" left, or each remaining one has an owner and a date.                |
| G10 | **Backups and restore**         | Check the Postgres backup list, the `backups` bucket after the first 02:15 Perth run (SLO-6), and perform one restore drill into a scratch database.                                                                                                                                   | A dump restores; the bucket holds the dump and the object copy.                               |
| G11 | **Malware scanning**            | Upload a harmless EICAR test file to a synthetic job in staging.                                                                                                                                                                                                                       | The file shows as infected and is not downloadable; a clean file scans and downloads.         |
| G12 | **Alerts and SLOs**             | Confirm an OTLP backend is approved (ADR-0009) or accept the interim limits in `docs/slo.md`.                                                                                                                                                                                          | Decision recorded.                                                                            |

## Bucket findings

**Railway Buckets do not offer object versioning** (checked 2026-10-09 by web search only, not on a live project). A Railway
staff reply quoted in Railway's community forum says the Buckets documentation lists object versioning, object locks, bucket
lifecycle configuration and server-side encryption as **not yet supported**; Put, Get, Head, Delete, List, Copy, presigned
URLs, tagging and multipart are supported. There are no automatic bucket backups, and a deleted bucket can be restored from the
project's activity feed for about 52 hours. Public buckets are not supported (we need none). Re-check the live docs page before
go-live and record the date of that check here: _unchecked by an operator yet_.

Consequences, as ADR-0008 exception 5 already assumes: an overwritten or deleted object cannot be recovered from the bucket
itself. Recovery points are the nightly `backup` service (database dump plus incremental object copy to the separate
`backups` bucket, 35-day retention), the pre-migration dump, and Railway's Postgres backups. The app purges files 30 days
after deletion (PRODUCT_SPEC section 14), so a mistaken delete is recoverable from the backup copy inside that window. Because no
lifecycle rules exist, retention pruning is done by the `backup` job itself, never by a bucket rule.

## Routine operations

- **Freeze deploys** (incident, error budget exhausted): set repository variable `DEPLOYS_FROZEN=true`; both jobs stop at
  their first step. Unset it to resume. Existing deployments keep running.
- **Redeploy or roll back a release:** run `deploy.yml` with `workflow_dispatch` and the release tag (for a rollback, the
  last good tag); staging deploys first and production waits for its approval. Both jobs check out that **tag** (not the
  branch chosen in "Use workflow from"), so the old release's service settings, `deploy-images.mjs`, `smoke.mjs` and ZAP rules
  run with its own images. Migrations are expand-only, so the old images run on the new schema.
- **A failed deploy** has already rolled back automatically; read the failing step (`[service] ...` names the service and why:
  drift, status, timeout), fix forward in a new release, and do not edit Railway settings by hand (the next deploy reports it as drift).
- **Settings changes** go through a pull request to `infra/railway/services/*.json` (CODEOWNERS review) and apply on the next deploy.
- **Rotations (every 90 days):** `RAILWAY_TOKEN`, the release App's private key, the GHCR token held by Railway, the Entra client secret, and the database
  role passwords; each also on staff departure or suspicion. Record dates in the operations log; the token age alert is in ADR-0008.
- **Quarterly:** review the accepted risks in ADR-0008, run a restore drill, and re-check Buckets versioning.
