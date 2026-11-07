# Teams/SharePoint integration — all three phases (WP-25, WP-26, WP-27) in one commit

Unzip this over your local clone. GitHub Desktop should show 139 changed or added files; nothing is deleted.
Delete this COMMIT.md before committing. Push to main (no PR approval needed per the 30 Oct rule; A1 size limit
waived by Craig on 6 Nov 2026 — add that line to AGENTS.md's REPO-SPECIFIC block yourself, it is a protected path).

## Commit message (summary line, blank line, body, trailers)

feat: Teams/SharePoint integration — admin settings, one-way push, two-way sync and channel creation (WP-25/26/27)

ADR-0015 amended 6 Nov 2026 (all three phases, admin-held Teams settings); spec §2.1/§4/§5.10/§9.3/§13/§16,
DATA_MODEL and the WP-25/26/27 plan updated.

db: migrations 0005 (teams_settings, job_teams_links, teams_folders, teams_file_pushes, teams.* operation types,
nullable operations.job_id), 0006 (team site URL on links) and 0007 (teams_inbound_items, teams_channels, files
source/teams_removed_at/deleted_reason, delta token, push deleting/deleted, poll/create/list operation types).
contracts: Teams capabilities, problem types, schemas and eleven routes; openapi regenerated.
api: flag teams-file-sync; teams-settings module (Admin → Teams, MFA, If-Match, audited, Test connection);
teams module (link/relink/unlink by pasted link or picked channel, Unfiled list file/dismiss, create channel,
channel list); create-job createTeamsChannel with the cache-based duplicate check; file badges from push rows;
app deletes propagate to Teams by eTag.
worker: registration config pinned to Microsoft hosts; Graph token/drive/teams clients (Retry-After, bounded
retries, 401 refresh, circuit breaker, chunked uploads with no bearer on session URLs, delta, download); local
Graph fake; handlers teams.check, teams.provision, teams.push (incl. fee proposals to the private channel and
delete propagation), teams.poll (import, Unfiled, replaced, removed, 410 resync), teams.list_channels,
teams.create_channel; scan hook; retry sweep; poll/cache scheduler at the admin-set interval.
web: /admin/teams, the job-page Teams panel (states, link dialog with picker, unlink, create channel), Unfiled
list, file badges, Create Teams channel on the new-job form with a live name preview.
docs: railway E13–E17 and G13, flags, runbook teams-sync-failures, deploy-and-rollback, threat model (M-25),
alerts, staff and client guides.

Behaviour with FEATURE_TEAMS_FILE_SYNC off is unchanged (every Teams route 404, no Graph client).

AI-Agent: claude.ai/claude-fable-5.1
Refs: WP-25

## Evidence (agent sandbox, Node 24.22.2 / pnpm 11.28.2, no Docker)

pnpm lint → exit 0 (eslint all packages, module boundaries ok, check-ci-matrix, check-work-packages: 27 WPs OK)
pnpm typecheck → 0 errors · pnpm format:check → clean · squawk → 0 issues in 7 migration files
builds: every package and service (apps/web production build needs internet for next/font/google: CI)
unit tests: workflow 41 · contracts 62 · db 3 · telemetry 70 · storage 183 · worker 109 · api 430 · web 1157
NOT RUN here (Docker): db/api/worker test:integration, api test:contract, e2e, mutation. Written for CI:
  api  test/security/authz-matrix (11 Teams rows), modules/teams/http/teams.contract.test.ts (flag on/off, settings,
       links, Unfiled, phase 3)
  worker handlers teams-check / teams-provision / teams-push / teams-poll / teams-create-channel .int.test.ts
       (all against test/fake-graph.ts; no Microsoft host is ever called)
Watch the first CI run of main for these; I will fix anything they report.

## Deploying (Railway builds nothing from source; everything goes through GitHub Actions)

1. Push to main → CI (lint, typecheck, unit, integration, contract, e2e). First run of the integration suites.
2. Merge the release-please PR ("chore(main): release 1.0.15") → release.yml builds, scans and signs the five images.
3. release.yml hands over to deploy.yml: staging (clamav → migrate [runs 0005–0007] → api → worker → web → backup,
   each health-gated, then smoke + ZAP), then production. Known catches from the handover: production needs a
   RAILWAY_TOKEN *environment* secret (Settings → Environments → production) or a manual run of Actions → deploy →
   "Use workflow from: main", tag v1.0.15; STAGING_URL / PRODUCTION_URL must start with https://.
4. Nothing changes in the app yet: FEATURE_TEAMS_FILE_SYNC defaults to off.

## Turning it on (staging first, with the test team)

5. Entra (Global Admin), per environment — railway.md E13–E17:
   E13 register "KR Tracker Teams files (staging)" (single tenant, no redirect URI);
   E14 application permission Sites.Selected + admin consent;
   E15 grant that app `write` on the test team's site (and later the live team's, and the Fee Proposals channel's
       own site if the restricted policy is used) — POST /sites/{id}/permissions or Grant-PnPAzureADAppSitePermission;
   E16 one client secret ≤ 90 days, value sealed as TEAMS_CLIENT_SECRET on worker only; calendar reminder;
   E17 (phase 3 only) application permissions Channel.ReadBasic.All and Channel.Create + admin consent.
6. Railway variables: worker → FEATURE_TEAMS_FILE_SYNC=true, TEAMS_TENANT_ID, TEAMS_CLIENT_ID, TEAMS_CLIENT_SECRET
   (sealed); api → FEATURE_TEAMS_FILE_SYNC=true. Deploy the staged changes.
7. Sign in as admin → Admin → Teams: team id, team site URL (Fee Proposals channel link + site URL if restricted),
   Save, Test connection. Every check should pass ("Can create channels" reads "not probed" until a job creates one).
8. Turn on Copy files to Teams; open a synthetic job; Link channel (pick from the list or paste); the panel goes
   provisioning → ready, the channel's "102. Subdivision Tracker" folder fills, clean files get "In Teams" badges.
9. Turn on Bring files added in Teams into the tracker (phase 2) and, once E17 is consented, Create channels for new
   jobs (phase 3). Each switch can be turned off on its own; the flag is the deploy-time kill switch.
10. Repeat 5–7 for production with the live team when KR is ready. Jobs linked in the test team keep their links.
