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
   `--timeout-minutes`), polled every 10 s. It stops at the first failing service and names the services not started.
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
