# Deploy and rollback

How a release reaches staging and production, how to approve it, how to stop or reverse it, and how to switch a feature
off. Source of truth: `.github/workflows/release.yml`, `.github/workflows/deploy.yml`, ADR-0008 and the guide in
[deploy/railway.md](../deploy/railway.md). Nobody and nothing deploys with the `railway` CLI or the dashboard: a
settings or image edit made there shows up as drift and fails the next deploy.

## The path of a release

1. A pull request merges to `main`; `release-please` keeps a release pull request open. A human approves and merges it.
2. `release.yml` builds each image once (`api`, `worker`, `web`, `clamav`, `ops`), scans it, attests provenance and the
   SBOM, and writes `image-<service>.txt` (one `ghcr.io/...@sha256:...` reference) onto the GitHub release. Then it calls
   `deploy.yml` with the tag (`vX.Y.Z`).
3. **Staging** deploys automatically: verify attestations, deploy `clamav`, `migrate`, `api`, `worker`, `web`, `backup`
   in that order (each must be healthy before the next), run `smoke.mjs`, then the ZAP baseline. Any failure rolls
   staging back to its previous digests.
4. **Production** waits for approval of the `production` GitHub Environment. After approval it repeats the deploy, then
   runs the smoke watch (every 30 s for 10 minutes against the SLO budgets). Any failure rolls production back
   automatically. `migrate` takes a `pg_dump` into the `backups` bucket before it applies pending migrations.

## Approving production

The approver is a KR reviewer who is not the person who launched the release; agents are never reviewers. Before
approving, check and write the answers in the operations log:

- Staging is green: smoke, ZAP and the release's own checks. Open the run, not just the badge.
- What the release changes, and whether it carries migrations (the dump will be taken; read the files in
  `packages/db/migrations/`, expand-only?). See [database-migrations](database-migrations.md).
- The error budget is above 50 % and no incident is open (`slo.md`). Deploys are not frozen.
- Someone is available to watch the 10-minute smoke watch and the first hour of dashboard 1.

## When a deploy fails

The failing step names the service and the reason. Read it before anything else.

| Message                                                        | Meaning and action                                                                                                                                   |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `[svc] Railway reports different settings: ...`                | Drift: someone edited the service in Railway. Put it back or change `infra/railway/services/<svc>.json` by pull request.                             |
| `deployment <id> is FAILED/CRASHED`                            | The new image did not become healthy. Read that service's logs; fix forward in a new release. For `migrate` see [migrate-failed](migrate-failed.md). |
| `deployment <id> still <status> after <n>s (timeout)`          | Health check never passed. Same as above; `migrate` and `clamav` are slow on a first start.                                                          |
| `deployment <id> is FAILED`, with a registry error in the logs | The GHCR credentials held by Railway expired: [secrets-rotation](secrets-rotation.md).                                                               |
| `Deploys are frozen (vars.DEPLOYS_FROZEN)`                     | The kill switch is on. See below.                                                                                                                    |
| `The Railway project has no service named ...`                 | A service was renamed in Railway; names must match exactly.                                                                                          |

A deploy that hangs is stopped by the step timeouts (the deploy step 75 minutes, longer than the scripted worst case of 65
minutes of health waits) and a cancelled run is rolled back too: the rollback step runs on failure **and** on cancellation.
An automatic rollback ran if the "Roll back" step is green. It restores the previous image digests of the services that
changed (and their recorded settings) from `previous-<env>.json`, a file the run wrote before its first change. The file
lives only on that run's runner, so it covers failures in the same run; for any later rollback use the tag route below.

## Roll back by hand

Use when a release is bad but the run passed (a problem found after the 10-minute watch), or a rollback did not run.

1. Find the last good tag on the GitHub Releases page. Check `docs/observability` dashboards for when errors began.
2. **Unfreeze first if frozen:** both jobs stop at their first step while `DEPLOYS_FROZEN` is `true`, rollbacks
   included. So roll back first, freeze afterwards.
3. Actions, workflow `deploy`, "Run workflow", enter the tag and keep **Use workflow from: `main`**: the `staging` and
   `production` environments accept deployments from `main` only (their Deployment branches and tags rule), so a run started from
   another branch or a tag is refused at the environment. It deploys staging, then production waits for approval.
   There is no shortcut around staging; it normally takes 10 to 20 minutes, so tell KR and mitigate meanwhile
   (a flag off, [api-availability](api-availability.md)). The run checks out **the tag itself** (`refs/tags/<tag>`, whatever
   `main` commit "Use workflow from" runs), so it applies that tag's `infra/railway/services/*.json`, `deploy-images.mjs`,
   `smoke.mjs` and ZAP rules together with that tag's image digests: a rollback deploys exactly what the old release shipped,
   not today's settings. Only `vX.Y.Z` tags are accepted; anything else stops at the first step.
4. Migrations are expand-only, so the old images run on the new schema; there are no down-migrations. Never try to
   reverse a migration. If data was damaged see [database-migrations](database-migrations.md).
5. Verify: `node infra/railway/scripts/smoke.mjs --base-url https://<web domain>`, then dashboard 1 for 30 minutes.
   Record the tag, run and approver.

To see what a tag would deploy without touching Railway (no token needed):
`gh release download <tag> -p 'image-*.txt'` then
`node infra/railway/scripts/deploy-images.mjs --environment production --images-dir . --dry-run`.

## Freeze deploys (kill switch)

Set the repository variable `DEPLOYS_FROZEN` to `true` (GitHub, Settings, Secrets and variables, Actions, Variables).
Every deploy job, staging and production, stops at its first step. Running services are untouched. Unset it or set
`false` to resume. Freeze after an incident rollback, while the error budget is exhausted (`slo.md`), when a secret is
suspected leaked, or while a restore is under way. Write the reason and the person who may lift it in the operations log.

## Kill a flag

Flags are read from environment variables when a service starts ([flags.md](../flags.md)). To switch one off:

| Flag                  | Variable                      | Set to `false` on  | Effect                                                                      |
| --------------------- | ----------------------------- | ------------------ | --------------------------------------------------------------------------- |
| `ai-stamp-reading`    | `FEATURE_AI_STAMP_READING`    | `worker` and `api` | No page image goes to Anthropic; the text rule and manual date entry remain |
| `entra-guest-invites` | `FEATURE_ENTRA_GUEST_INVITES` | `api`              | Grants stop sending Entra invitations; KR IT invites guests by hand         |

Confirm before running: the environment is the one in trouble, the variable is the flag's, and a second person agrees in
production. Change it in the Railway dashboard (service, Variables), redeploy each service from the dashboard, then
check the logs show the service restarted and the feature is off (try a stamp reading in staging). Note the time and
who in the operations log, and mention it at the flag's next review date in `docs/flags.md`. Do not delete the variable.
