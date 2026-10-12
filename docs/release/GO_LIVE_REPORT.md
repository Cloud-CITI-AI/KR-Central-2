# Go-live report: KR Subdivision Tracker 1.0.0

Date: 2026-10-12. Release candidate: `main` at the commit that adds this report (see `git log -1 -- docs/release/GO_LIVE_REPORT.md`).
Prepared by the orchestrating agent (AI-Agent: claude-code/claude-opus-5-5) for the KR Surveys reviewers who approve the
release. Every number below was measured on that commit in the release gate unless it says otherwise.

**Recommendation:** the code is ready for a staging deployment. Production go-live stays blocked on the human items in
[Before production](#before-production-blocking-human-items): the High-tier approvals, the go-live checks G1 to G12 in
staging, the prototype parity sign-off and the GitHub plan prerequisites.

## 1. What it is, compared with the prototype

The prototype was a single HTML file (`docs/reference/prototype/`): one demo job, data in the browser, a "can edit" switch,
canvas screenshots for print, and developer notes. 1.0.0 keeps its workflow, wording and look and makes it a multi-user
system. The spec that says which behaviour was ported and which was changed is `docs/spec/PRODUCT_SPEC.md` (sections 13
and 17 list the developer notes and the additions).

| Area                | Prototype                                         | 1.0.0                                                                                                                                                                                              |
| ------------------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Workflow            | 10 stages, 46 checkpoints, computed progress      | The same 46 checkpoints as typed data (`@kr/workflow`), rules R1 to R15 (progress, next actions, alerts, Perth dates) implemented once and used by API and web                                     |
| Jobs                | one demo job in the page                          | Postgres-backed jobs: create, edit, archive and unarchive, dashboard with status, type and search filters, facets, cursor paging, 15 s refresh                                                     |
| People and access   | one "can edit" flag                               | Entra ID sign-in (single tenant, B2B guests), roles admin, kr_admin, staff, client, architect; per-job grants via the access manager; first eligible staff sign-in becomes admin; admin users page |
| Fee proposal        | visible to all                                    | Visible only with `fee_proposal.view` (kr_admin, admin, client), as the developer notes asked                                                                                                      |
| Documents           | file names only                                   | Streamed uploads to a private bucket, type sniffing, ClamAV scanning with retries, in-app PDF, image, video and email viewer, job package zip                                                      |
| Document reading    | in-browser parsing, AI call from the page         | Worker reads Decision Letters (conditions), conformance notices (dates, optional Claude vision behind a flag, off by default), emails (.eml, .msg, pasted)                                         |
| Concurrency         | none                                              | `If-Match` versions on jobs, checkpoints and conditions; typed text is never lost on a 412 or a session expiry                                                                                     |
| Print               | canvas screenshots                                | Print stylesheet, Save as PDF keeps the header, bars and status colours                                                                                                                            |
| Audit and retention | none                                              | Audit trail (admin page), files purged 30 days after deletion, nightly backups and pre-migration dumps                                                                                             |
| Accessibility       | not assessed                                      | WCAG 2.2 AA target: axe checks in both themes, focus management, keyboard-scrollable viewer, contrast fixed (D3, D6, D7)                                                                           |
| Out of scope        | SharePoint sync, ePlanning watcher, website embed | Recorded as future work in ADR-0012 and PRODUCT_SPEC section 16                                                                                                                                    |

Prototype parity is measured screen by screen in `apps/web/e2e/parity/CHECKLIST.md` (25 views of the blank demo job, light,
dark and 390 px); each row names the expected differences. **No row is signed off yet** (a human ticks them).

## 2. Architecture

ADR-0004 (modular monorepo), pnpm 11 workspaces on Node 24, TypeScript strict throughout.

- `apps/web`: Next.js 16 App Router. Server-rendered shell, same-origin BFF proxy `/api/v1/*` to the API (ADR-0005), nonce
  CSP, CSS Modules with the prototype's design tokens. First-load JS per route at most 166.4 KB gzip (budget 170 KB).
- `services/api`: Fastify 5 modular monolith (auth, jobs, checkpoints, files, conditions, operations, notes, access, users,
  audit). Server-side sessions (ADR-0002), CSRF, rate limits, problem+json errors, contract-first routes from
  `@kr/contracts` (zod, generated OpenAPI 3.1).
- `services/worker`: Postgres operations queue poller (ADR-0006): malware scan, conditions extraction, conformed-date
  reading, email parsing, sweeps; untrusted parsing in a resource-limited `worker_thread` with an empty environment.
- `services/ops`: `migrate` (pre-migration `pg_dump`, then forward-only migrations; the only holder of the migrator role)
  and the nightly `backup` cron (read-only `tracker_backup` role, dump and incremental object copy to a second bucket).
- Data: Postgres 17 with Kysely and SQL migrations 0001 to 0004, three roles (migrator, app, backup; ADR-0007). Files in a
  private S3-compatible Railway Bucket (ADR-0011).
- Hosting: Railway, one project, `staging` and `production` environments, services `clamav`, `migrate`, `api`, `worker`,
  `web`, `backup`, Postgres and the `files` and `backups` Buckets. Images are built and attested in GitHub Actions and
  deployed by digest, in order and health-gated, with automatic rollback (ADR-0008, `infra/railway/`).
- Observability: JSON logs without personal data, OpenTelemetry metrics and traces, health and readiness checks, SLOs
  (`docs/slo.md`) and alert rules with one runbook each (ADR-0009). The OTLP backend still needs approval (G12).
- Configuration: every variable validated at start-up, fail-closed in staging and production (no placeholder secrets, an
  explicit `APP_ENV`, the pinned Entra authority, MFA for admins); two feature flags, both off (`docs/flags.md`).

## 3. Test evidence (release gate, 2026-10-12)

Run on one 4-core, 15 GB machine against the release-candidate commit.

| Gate                                                                                               | Result                                                                                                                                                                                                                                                                                                                                              |
| -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile`                                                                   | pass, lockfile up to date                                                                                                                                                                                                                                                                                                                           |
| `pnpm verify` (lint, typecheck, build, unit, integration, contract)                                | **pass** (exit 0)                                                                                                                                                                                                                                                                                                                                   |
| Lint                                                                                               | pass: ESLint with `--max-warnings=0` in 15 packages, CI matrix and work-package checks                                                                                                                                                                                                                                                              |
| Typecheck                                                                                          | pass, every package                                                                                                                                                                                                                                                                                                                                 |
| Unit                                                                                               | **2,304 tests in 275 files, 0 failed** (web 1,134; api 401; document-parsing 230; storage 183; ops 78; worker 70; telemetry 70; contracts 60; workflow 37; mock-idp 13; config 12; design-tokens 10; db 3; logger 3). Web line coverage 99.3 %                                                                                                      |
| Integration (real Postgres 17 and S3 mock in containers)                                           | **889 tests in 93 files, 0 failed** (api 668, worker 163, storage 27, db 18, ops 13)                                                                                                                                                                                                                                                                |
| Contract (responses validated against `openapi.yaml`)                                              | **52 tests in 12 files, 0 failed**; `pnpm openapi:check` up to date                                                                                                                                                                                                                                                                                 |
| Build                                                                                              | pass, every package and the Next.js production build                                                                                                                                                                                                                                                                                                |
| E2E (Playwright, full stack: Postgres, S3 mock, mock Entra, api, worker, web, real ClamAV project) | **pass in CI mode** (`CI=1`: 2 workers, 2 retries): **162 tests (146 chromium, 11 mobile, 5 real ClamAV), 158 passed first time, 4 flaky (passed on retry), 0 failed**, 10.2 min. Earlier runs in the gate: 4 local workers 159 passed, 3 failed (all pass alone); CI mode before the two test fixes 158 passed, 3 flaky, 1 failed (access journey) |
| `format:check` (Prettier)                                                                          | pass                                                                                                                                                                                                                                                                                                                                                |
| `perf:check` (first-load JS, gzip, budget 170 KB)                                                  | pass: `/jobs/[jobId]` 166.4 KB, `/` 166.0, `/admin/audit` and `/admin/users` 165.2, signed-in 404 164.3, `/sign-in` 146.8, other public routes 146.0; lazy JS 306.1 of 307 KB; no waivers                                                                                                                                                           |
| `perf:unit`                                                                                        | 28 tests pass                                                                                                                                                                                                                                                                                                                                       |
| `perf:vitals` (reference profile, p75 of 5 cold loads)                                             | **pass**: dashboard LCP 1,892 ms, CLS 0.003, INP proxy 88 ms; tracker LCP 1,684 ms, CLS 0.000, INP proxy 128 ms (budgets 2,500 ms, 0.1, 200 ms)                                                                                                                                                                                                     |
| `perf:k6` (2,000 jobs, 10 VUs, 30 s; p95 < 300 ms, p99 < 800 ms)                                   | **pass**, 0 % failed requests, 4,445 checks: p95/p99 `list_jobs` 130/161 ms, `list_picker` 137/178 ms, `job_facets` 131/147 ms, `get_job` 102/140 ms; 889 iterations                                                                                                                                                                                |
| `test:infra` (Railway scripts, compose, CI wiring, docs)                                           | **130 tests pass**                                                                                                                                                                                                                                                                                                                                  |
| gitleaks 8.30.1, full history                                                                      | **no leaks found** (472 commits, all branches)                                                                                                                                                                                                                                                                                                      |
| `pnpm audit --prod`                                                                                | **no known vulnerabilities**                                                                                                                                                                                                                                                                                                                        |
| playbook-guard checks run locally                                                                  | pass: LESSONS.md append-only (4 entries, 0 errors), instruction-file budgets, no unfilled placeholders, no protected path touched by the release commits, commitlint clean. The PR-only checks (labels, PR template, size) have no PR to run on (see 5)                                                                                             |

Fixed in the gate (each a separate commit with its evidence): the web's node-environment unit tests loaded `@kr/*` from a
stale `dist/` (2 suites failed), `pnpm verify` tested before it built (6 ops integration tests failed on a stale build),
the worker's end-to-end pipeline test timed out at 10 s when three integration suites shared four cores, the access
journey clicked before the page hydrated, and the dashboard print test looked for its job on the first page of a shared
stack. No product code changed in the gate.

## 4. QA history

Independent tester agents (functional, logic, security, parity, shipping) tested the integrated `main` three times. The
orchestrator triaged every finding into a fix batch or a recorded rejection or deferral (`docs/plan/DECISIONS_LOG.md`).

| Round | Reported                                  | Fix batches (all merged)                                                               | Outcome                                                                          |
| ----- | ----------------------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| 1     | about 70, 10 high                         | 8: API-INPUT, AUTH-CONFIG, CONFORM, DEPLOY, EDITS, VIEWER-SHELL, WEBCLIENT, A11Y-PERF  | every high fixed                                                                 |
| 2     | 38: 1 critical, 6 high, 15 medium, 16 low | 8: API, CI, EDITS, NAV, OPS, PERF-API, PERF-WEB, VISUAL                                | critical and highs fixed (incl. list latency at 2,000 jobs, p95 4.3 s to 214 ms) |
| 3     | 9: 0 critical, 1 high, 3 medium, 5 low    | 4: CLAMAV (high: content past scan limits reported OK), COMPOSE, DASHBOARD-CLS, VIEWER | high and mediums fixed; the 5 lows deferred to 1.0.x (section 6)                 |

Safety review in the gate: a safety monitor flagged the coder session of FIX-R2-PERF-API. Its six merged commits
(`457868e`..`12f50b1`) were reviewed in full: summary cache and fingerprint reads for the job list and facets, the lazy job
picker, the 2,000-job k6 seed, tests and the CHANGELOG. Nothing kills processes, prunes Docker, disables or loosens a check,
touches CI or secrets, or calls a new host. Nothing was reverted.

## 5. Known limitations and deviations

- **Linear commits instead of GitHub pull requests.** The repository had no GitHub remote while it was built, so agent work
  landed as linear commits on `main` carrying `AI-Agent:` and `Refs:` trailers, reviewed and gated by the orchestrator. No
  GitHub-side CI, CodeQL, dependency review or playbook-guard run exists for them; the first push and the release pull
  request are where they first run.
- **High-tier approvals outstanding.** The playbook requires two human approvals, including the domain CODEOWNER, for the
  High-tier work packages WP-01, 03, 04, 06, 07, 08, 09, 10, 11, 12, 20 and 23 and their fix batches. None has been given.
- **Known-defect tests:** no `test.fail` entry remains. D1 to D7 of WP-19 are fixed; the contrast defects D3, D6 and D7 keep
  their regression tests (`e2e/a11y/known-defects.spec.ts`, `states.spec.ts`).
- **Performance ceiling:** the tracker's INP is held to a 0.3 s ceiling (`KNOWN_BREACHES`, p75 0.18 to 0.24 s against the
  0.2 s budget on the slow reference profile) because the 46 cards re-render after a status save. This gate measured p75 128 ms, within budget; the entry can go once
  that holds over several runs. Bundle waivers: none.
- **Unverified platform behaviour** (verified only in staging, by the go-live checks): Entra `amr`/`acrs` MFA evidence, the
  forwarded-address hop count, Railway API shapes, IPv6 private networking, and Railway Buckets having no versioning.
- **GitHub plan prerequisites:** the required `security / scan` check needs GitHub Code Security on a private repository and
  the deploy needs artifact attestations (public repository or Enterprise Cloud). Alternatives are documented in the deploy
  guide; each needs an ADR-0008 amendment.
- Mutation testing: Stryker is configured per package, but CI's mutation step and the API's run are blocked by D-4 and D-5
  (section 6).

## 6. Open issues by severity

| Severity | Item                                                                                                                                                                                                                                                                    | Owner / next step                                              |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Critical | none                                                                                                                                                                                                                                                                    |                                                                |
| High     | none in the code. Release blockers that are human actions: High-tier approvals, go-live checks G1 to G12, parity sign-off, GitHub plan prerequisites (section 7)                                                                                                        | KR reviewers and platform owner                                |
| Medium   | D-4: CI's mutation step passes `--thresholds.break`, which Stryker 10 rejects, so it fails whenever a PR changes a mutated file (`.github/workflows/reusable-ci-node.yml`, a protected path)                                                                            | platform and security CODEOWNERs (`docs/security/findings.md`) |
| Medium   | D-5: the API's mutation run cannot start in Stryker's sandbox (the OpenAPI file is read by a relative path in `services/api/test/helpers/contract.ts`)                                                                                                                  | api owner                                                      |
| Medium   | E2E flakiness under load: the admin and access journeys fail a first attempt now and then (a Chromium "Target crashed", a list row not yet updated) and pass on retry; 4 flaky of 162 in the final CI-mode run on a 4-core machine. CI reports flaky tests as a warning | web owner: watch the first GitHub CI runs; fix any that repeat |
| Low      | D-1: the sign-in rate-limit key is the raw rightmost `X-Forwarded-For` entry (behind the trusted BFF hop); D-3: framework 404s for some paths carry no CSP                                                                                                              | security CODEOWNER (`docs/security/findings.md`)               |
| Low      | A server render error is logged twice: the JSON line plus Next's default multi-line dump (`apps/web/src/instrumentation.ts`)                                                                                                                                            | 1.0.x                                                          |
| Low      | Print and Save as PDF: footer and the "JOB" and "STAGES" labels are near-invisible (the `@media print` block keeps `--on-bg` #f2f2f0 and `--on-bg-2` #d6d6d2, made for the dark header band, on a white sheet)                                                          | 1.0.x                                                          |
| Low      | File-type badge follows the file name (`DocRow.tsx`), so a sniffed PDF named `report.exe` shows "EXE"                                                                                                                                                                   | 1.0.x                                                          |
| Low      | The 500 page keeps the failed page's document title                                                                                                                                                                                                                     | 1.0.x                                                          |
| Low      | The file content API says "remove it and upload it again" for a failed scan before the automatic re-scans are used up (`content-headers.ts`)                                                                                                                            | 1.0.x                                                          |

Product questions still open for KR Surveys are listed in PRODUCT_SPEC section 18 (staff domains, architect decisions,
Graph invitations, AI stamp reading consent, region and domain, observability backend, retention of completed jobs' files).

## 7. Exact deploy steps

The full procedure, with every variable, is `docs/deploy/railway.md` (start at "Quick path"); rollback is
`docs/runbooks/deploy-and-rollback.md`. In order:

1. **Prerequisites.** Push this repository to GitHub under the KR organisation. Confirm GitHub Code Security and artifact
   attestations are available (or approve an alternative by ADR-0008 amendment). Apply the org ruleset with the required
   checks, CODEOWNERS and the `release` GitHub App (`RELEASE_APP_CLIENT_ID`, `RELEASE_APP_PRIVATE_KEY`, `RELEASE_APP_SLUG`).
2. **Approvals.** Open the history as reviewed pull requests or record the CODEOWNER approvals of the High-tier packages
   (section 5), and sign off the parity checklist rows.
3. **Railway, per environment (staging first).** Project with `staging` and `production`; Postgres 17 with backups on;
   Buckets `files` and `backups` with their keys (read-only `files` keys for `backup`); image services `clamav`, `migrate`,
   `api`, `worker`, `web`, `backup` with GHCR pull credentials; a public domain on `web` only; a volume and 2 to 3 GB for
   `clamav` (guide steps 1 to 8).
4. **Database roles.** From a workstation: `pnpm install --frozen-lockfile && pnpm --filter @kr/db build`, then
   `SUPERUSER_DATABASE_URL=... TRACKER_MIGRATOR_PASSWORD=... TRACKER_APP_PASSWORD=... TRACKER_BACKUP_PASSWORD=... node packages/db/dist/bootstrap-cli.js`
   (expect `bootstrap complete`); close the public TCP proxy; build the three role URLs.
5. **Entra ID.** One single-tenant app registration per environment, checklist E1 to E10: redirect URIs for the callback
   and `/signed-out`, delegated `openid profile email`, one client secret of at most 90 days (sealed, `api` only), the
   optional claims, and a Conditional Access policy requiring MFA.
6. **Variables.** Every variable of "Variables per service" on each service, secrets sealed, `NODE_ENV=production`,
   `APP_ENV=staging|production`, `MALWARE_SCAN_MODE=required`, `REQUIRE_MFA_FOR_ADMIN=true`, both feature flags `false`.
7. **GitHub environments.** `RAILWAY_TOKEN` (one project token per environment), `STAGING_URL` and `PRODUCTION_URL`,
   required reviewers on `production` (not the launcher), deployment branches limited to `main`.
8. **Release.** Merge the release-please pull request (it proposes 1.0.0 from the `Release-As: 1.0.0` commit). `release.yml`
   tags, builds, attests and records the image digests, then calls `deploy.yml`: staging deploys `clamav`, `migrate`, `api`,
   `worker`, `web`, `backup` in order, health-gated, then smoke tests and the ZAP baseline.
9. **First sign-in and go-live checks in staging.** The first KR staff member to sign in becomes admin (G6); then G1 to G12
   (MFA evidence, guest grants, forwarded address, deploy rehearsal with a forced rollback, backups and a restore drill,
   EICAR upload, alerts). An unproven item blocks production.
10. **Production.** Approve the `production` job of the same run; repeat G6 (first admin) and the smoke watch.
11. **Rollback.** A failed deploy rolls back automatically to the recorded digests. To roll back later, run `deploy.yml`
    from `main` with the last good tag; migrations are expand-only, so the older images run on the newer schema.

## Before production (blocking human items)

- [ ] GitHub repository, ruleset, CODEOWNERS, release App, Code Security and attestations (section 7 step 1)
- [ ] High-tier approvals and parity sign-off (section 5)
- [ ] Go-live checks G1 to G12 recorded in staging (`docs/deploy/railway.md`)
- [ ] Decide D-4 and D-5 (fix, or accept mutation testing off for 1.0.0)
- [ ] Answers to PRODUCT_SPEC section 18 that affect configuration (staff domains, region and domain, flags)
