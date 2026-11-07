# ADR-0015: Teams/SharePoint integration in three phases

- Status: accepted (amended 2026-11-06: all three phases in scope, admin-held Teams settings)
- Date: 2026-10-27 (updated 2026-10-29 with KR's answers; amended 2026-11-06 by Craig's decisions)
- Deciders: KR Surveys (Craig) — accepted 2026-10-30 (in the project Slack thread; recorded at Andrew Thurlow's request);
  amendment approved 2026-11-06 by Craig in the development chat
- Drafted by: agent claude (orchestrator) for the launching human (Andrew Thurlow)
- Related: supersedes the "SharePoint/Teams folder sync" paragraph of ADR-0012; ADR-0006, ADR-0011, ADR-0013,
  ADR-0014; docs/spec/PRODUCT_SPEC.md §2.1, §5.10, §9.3, §13 row 4, §16; work packages WP-25 (phase 1), WP-26 (phase 2), WP-27 (phase 3)

## Context

ADR-0012 deferred "SharePoint/Teams folder sync" as a later worker operation `sharepoint.sync` (Microsoft Graph,
`Sites.Selected`, the zip folder layout, a job → Teams channel mapping, admin consent). The developer note behind it
(PRODUCT_SPEC §13 row 4) only asked for a one-way push into an existing channel.

KR's proposal (October 2026) asks for more:

1. A new job creates or links its Teams channel and folder structure.
2. Each job links to its channel. Files live in the channel folder, so anything added in the app shows in Teams and
   anything added in Teams shows in the app.
3. Files are stored in the job's Teams channel folder, and the app's folder structure mirrors the channel in both
   directions.

On 27 Oct 2026 Andrew Thurlow and Craig (KR Surveys) agreed to deliver this in phases. On 29 Oct KR confirmed (via
Andrew) that job channels are standard channels in the existing team "Team Survey", and only that team is in scope.
Each project channel's Files root has three template folders: `100. Initial SURVEY`, `101. Subdivison Process` (KR's
spelling) and `102. Subdivision Tracker`. In KR's words, 102 "would be the 'live' folder that works as a medium between
Teams and the tracker. This is the folder that gets zipped up and sent when you click it in the tracker." Channel names
follow `S-<job number>_<ADDRESS, SUBURB IN CAPS> (<client>)`, for example `S-0042_1 EXAMPLE RD, SUBURB (CLIENT)`
(synthetic values; real names are client data, TD-1). Only KR admins link a job to its channel.

Facts from the current code (main @ 223bc9a):

- **Queue and worker.** The only queue is the `operations` table (ADR-0006). Its `type` is a CHECK enum
  (`packages/db/migrations/0001_initial_schema.sql`), so a new operation type needs a migration. Handlers are registered
  in `services/worker/src/handlers/index.ts`, hourly sweeps in `services/worker/src/sweeps/index.ts`. The worker has no
  inbound network; only `web` has a public domain.
- **Credentials.** Only the `api` holds `ENTRA_CLIENT_SECRET` (ADR-0013, railway.md E7). The worker has no Entra
  variables. The only Graph call today is the optional guest invitation (ADR-0014): plain `fetch`, client-credentials
  grant, cached token, 10 s timeout (`services/api/src/modules/access/data/graph-inviter.ts`).
- **Files.** The bucket is the system of record. Content is served only when it is `clean` (ADR-0011). Every file
  targets one checkpoint slot or one condition (`files_target_check`). The folder structure is the zip layout (§5.8,
  `@kr/workflow` helpers `stageFolderName`, `checkpointFolderName`, `conditionEvidenceFolderName`). The package download
  zips exactly that layout, which makes it the contents of 102.
- **Confidentiality.** Fee-proposal files (checkpoint 1.0, `restricted: "fee_proposal"` in
  `packages/workflow/src/definition.ts`) are hidden from ordinary staff (`STAFF_JOB` lacks `fee_proposal.view` in
  `packages/contracts/src/permissions.ts`). Every member of a team can read a standard channel's files. KR wants fee
  proposals in Teams, but not visible to everyone (29 Oct).
- **Jobs.** The job number allows `/` and can be edited later; it is unique only among active jobs. This matters in
  phase 3, when the app names channels.

## Decision

We will deliver the integration in **three phases**, each behind the feature flag `teams-file-sync` (default off). The
**worker** does all Microsoft Graph work, using a **separate app registration** whose only permission is
**`Sites.Selected`** on the "Team Survey" site and on the private "Fee Proposals" channel's site.

| Phase     | What it delivers                                                                                                                                                                                                                                                                                                                                                                                          | New Graph permission (application)                                                  |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| 1 (WP-25) | A tested Graph connector. A KR admin links each job **by hand** to its **existing standard channel** in "Team Survey". The app creates `102. Subdivision Tracker` if missing and the zip layout's stage/checkpoint folders inside it, never touching `100.` or `101.`. **One-way, additive push** (app → Teams) of every **clean** file. Fee proposals go to the private Fee Proposals channel (PR 25-i). | `Sites.Selected`, role `write`, on the team site and the Fee Proposals channel site |
| 2         | **Two-way sync.** A worker delta poll (no webhooks) brings files added to 102 into the app: downloaded, sniffed, scanned, mapped to a checkpoint slot or put on an **Unfiled** list. Needs a migration so a file can be unfiled, delete and conflict rules agreed with KR, its own work package and an amendment to this ADR.                                                                             | None expected (verify delta with `Sites.Selected`)                                  |
| 3         | **The app creates the channel** at job creation, with the "A channel with this name already exists — choose a different job name" warning and all three template folders. Needs KR to confirm the naming format, its own work package and an amendment.                                                                                                                                                   | `Channel.Create`, `Channel.ReadBasic.All` (verify)                                  |

### Phase 1 specifics

1. **Where it runs: the worker.** The API never calls Graph for this feature. It validates and stores the pasted link
   and queues the work in the same transaction. Two operation types replace ADR-0012's `sharepoint.sync`:
   `teams.provision` (resolve the channel folder, create folders) and `teams.push` (copy pending files). A new hourly
   sweep queues retries for jobs with failed or pending pushes.
2. **Credential: a separate app registration** per environment ("KR Tracker Teams files (<env>)"): single tenant, no
   redirect URI, no delegated permission, one application permission. Its secret (≤ 90 days) is the sealed
   `TEAMS_CLIENT_SECRET`, set **only on `worker`**. ADR-0013 holds unchanged. A certificate credential (option C) can
   replace the secret later; it needs `openid-client` in the worker (A8 request).
3. **Permission: `Sites.Selected`, role `write`.** KR's admin consents it, then grants `write` on the "Team Survey" site
   and on the Fee Proposals channel's own site (Graph `POST /sites/{site-id}/permissions` or PnP
   `Grant-PnPAzureADAppSitePermission`). The app sees no other site, mailbox or team. Phase 1 needs no Teams permission.
4. **Linking: a KR admin pastes the channel link** ("Get link to channel"). The API parses it and fetches nothing. Host
   `teams.microsoft.com` or `teams.cloud.microsoft`, path `/l/channel/{channelId}/{channelName}`, `groupId` equal to the
   configured team id, `tenantId` equal to the KR tenant. The worker resolves `/{channel name}` in the team site's default
   library and stores drive and item ids; every later call uses ids. A missing folder (private, shared or renamed
   channel) sets the link to `error`. Picking from a list is rejected for phase 1: it needs `Channel.ReadBasic.All`.
5. **Standard job channels only.** Private and shared channels have their own sites. The Fee Proposals channel is the
   one deliberate exception (decision 10).
6. **Folder structure: mirror the app's layout into `102. Subdivision Tracker`** (`TEAMS_ROOT_FOLDER`), created if
   missing. The app never reads, writes, renames or deletes `100.`, `101.` or anything else in the channel. Inside 102 it
   creates every stage and checkpoint folder of §5.8 up front (without the zip's top folder and `Job summary.txt`;
   without `1.0 Fee proposal`), names from the `@kr/workflow` helpers. Condition evidence folders are created on first
   use. Existing folders are reused, never renamed or deleted. Folder ids are stored per job.
7. **Push rules.** A file is queued when its scan passes as **`clean`** (`skipped` never), the flag is on, the link is
   `ready` and the checkpoint's sync policy is `sync`. Push is additive: deletes, replacements and Teams-side edits are
   not propagated. Existing clean files are pushed after linking. Archived jobs push nothing.
8. **Idempotency.** A `teams_file_pushes` row per file records `uploading`, then `pushed` with the driveItem `id`,
   `eTag` and remote path. Uploads use `@microsoft.graph.conflictBehavior=fail` and the zip's " (2)" suffix rule. A retry
   that finds an item while the row says `uploading` adopts it when the size matches and `createdBy.application.id` is
   this app (verify); otherwise it takes the next suffix. An item whose `eTag` differs from the stored one is never
   overwritten.
9. **Throttling and large files.** `Retry-After` honoured on 429, 503 and 504; bounded retries with jitter, then the
   operation fails (BE-10); circuit breaker; `User-Agent` `NONISV|KRSurveys|KRTracker/<version>`; one push per job at a
   time. Files ≤ 4 MiB use `PUT …/content`, larger ones `createUploadSession` with 10 MiB chunks streamed from the
   bucket. The upload URL is never logged and never gets an `Authorization` header.
10. **Fee proposal (1.0): a private "Fee Proposals" channel.** Chosen by Andrew Thurlow for KR on 29 Oct. One private
    channel named `Fee Proposals` in "Team Survey", whose only members are KR admins, with one subfolder per job. The
    app only uploads; Teams enforces privacy through channel membership and the app sets no permissions. The channel's
    own site gets its own `Sites.Selected` `write` grant. A pure function `syncPolicyFor(checkpoint, config)` returns
    `sync`, `exclude` or `restricted`; checkpoints marked `restricted: "fee_proposal"` follow `TEAMS_FEE_PROPOSAL_POLICY`
    (default `exclude`; `restricted` routes to the Fee Proposals channel once PR 25-i lands). Fee files never go into a
    job channel. The job page links to the job's subfolder for users who may see fee proposals.
11. **No webhooks.** Phase 1 reads no changes; phase 2 uses delta polling from the worker.
12. **Audit, observability, flag.** Audit `job.teams_linked`, `job.teams_unlinked` (user), `teams.folders_provisioned`,
    `file.teams_pushed` (system). Metrics `kr.teams.pushes{result}` and `kr.teams.graph_requests{status_class}` with
    closed attributes. `teams-file-sync` is read by `api` and `worker` and listed in `docs/flags.md`. Flag off: routes
    answer 404, nothing is queued, queued work completes as a no-op.
13. **External hosts (X7).** `graph.microsoft.com` and `login.microsoftonline.com`, already approved for the api
    (ADR-0014), are approved for the **worker** for the drive endpoints in WP-25 only. Staging and production refuse any
    other Graph or authority base URL; tests use a local fake.

## Options considered

| Option                                                                     | Pros                                                                  | Cons                                                                                                                                     |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| A. Worker, separate registration, client secret, `Sites.Selected` (chosen) | Least privilege; ADR-0013 unchanged; no new dependency                | A second secret and registration per environment                                                                                         |
| B. Worker uses the sign-in registration                                    | One registration                                                      | Breaks ADR-0013/E7; one leak exposes both                                                                                                |
| C. Separate registration with a certificate                                | No shared secret; Microsoft's recommendation                          | Worker dependency (`openid-client`) and certificate rotation; can replace A later                                                        |
| D. API does the sync inline                                                | Immediate feedback                                                    | Graph latency on request paths; API holds a file-write credential                                                                        |
| E. `Files.ReadWrite.All` / `Sites.ReadWrite.All` and a channel picker      | Fewer unknowns                                                        | Tenant-wide write to every site and OneDrive                                                                                             |
| F. Graph change notifications                                              | Near-real-time inbound                                                | Public endpoint, handshake, renewal; not needed for one-way push                                                                         |
| G. All three phases at once                                                | One consent round                                                     | Biggest risk at once; inbound mapping and naming undecided                                                                               |
| Fee 1. Private Fee Proposals channel (chosen)                              | Teams enforces privacy; app sets no permissions; one extra site grant | Fee files sit outside the job's channel                                                                                                  |
| Fee 2. Locked `Fee Proposal` subfolder per job channel                     | Fee files inside the job channel                                      | SharePoint REST `BreakRoleInheritance` with a certificate, a `fullcontrol` grant and `*.sharepoint.com` as a new host; one scope per job |
| Fee 3. Per-file permissions inside 102                                     | None over Fee 2                                                       | Permissions set on every upload; each file briefly visible to the whole team                                                             |

## Consequences

- Positive: KR staff see tracker files in Teams for every linked job, with only site-scoped permissions. Phases 2 and 3
  build on the stored link, the folder map and the push rows.
- Negative: KR IT runs a second registration per environment, admin consent, two site grants and secret rotation (new
  railway.md E13–E16), and creates and staffs the Fee Proposals channel. Files exist twice; the bucket stays
  authoritative until phase 2. App deletes are not reflected in Teams in phase 1. Fee files are not in the job channel.
- Harder later: phase 3 must solve channel naming (`/` in job numbers), renames, reused numbers of archived jobs, the
  team's channel limit (about 1,000 including deleted channels; verify) and a synchronous name check in create-job.
- Must now be true: migration `0005` (link, folder and push tables plus the two operation types, expand only); job
  capability `teams.link` for kr_admin and admin only, in `permissions.ts` and spec §2.1; Graph fakes in tests; runbook
  `docs/runbooks/teams-sync-failures.md`; rows in `docs/flags.md`, `.env.example` and `docs/deploy/railway.md`; a
  threat-model update for the trust boundary worker → Microsoft 365.

## Verification items (spike, WP-25 PR 25-a)

Run against a test tenant or a KR test team, never production data. KR IT or the launching human holds the test
registration's secret and runs the calls. Any "no" on V1, V3, V4, V5 or V6 stops WP-25 until the plan of record is
revised and approved again.

Results: the spike (PR 25-a, 29 Oct 2026) passed 23/23 checks against the test team KRTrackerTest and its
`-FeeProposals` site. The detailed per-check output lives in the project Slack thread (Teams decisions, 29–31 Oct);
Craig directed on 6 Nov 2026 that it be recorded here as "verified 29 Oct per Slack, 23/23" rather than transcribed.

| #   | Question                                                                                                                                                                                                                         | Result                                                                                                                                               |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| V1  | With only `Sites.Selected` and `write`, can an app-only token resolve the site by path, read its default drive, create folders, upload (simple and upload session) and read `createdBy.application.id`?                          | Verified 29 Oct per Slack (23/23): one-site `Sites.Selected` grants work, the tenant root is refused, `createdBy.application.id` is set              |
| V2  | Does `GET /teams/{team}/channels/{channel}/filesFolder` fail with `Sites.Selected` alone? Which least permission makes it work? (Phase 3 picker.)                                                                                | Verified 29 Oct per Slack (23/23); detail not transcribed. WP-27 adds `Channel.ReadBasic.All` for the picker as this ADR's phase 3 row planned       |
| V3  | Do channel links from current clients (new Teams desktop, web, `teams.cloud.microsoft`) carry the channel id, `groupId` and `tenantId`? Is the URL name the folder name? After a rename, does the folder keep its original name? | Verified 29 Oct per Slack (23/23): a renamed channel keeps its id                                                                                    |
| V4  | Private and shared job channels: is the folder absent from the team site, so linking fails cleanly?                                                                                                                              | Verified 29 Oct per Slack (23/23)                                                                                                                    |
| V5  | Simple-upload size limit, upload-session chunk rules, path length, forbidden names and characters. Are `102. Subdivision Tracker` and the stage folder names (e.g. `02 WAPC Approval`) accepted as written?                      | Verified 29 Oct per Slack (23/23): names accepted; 409 on duplicate names                                                                            |
| V6  | Does a `Sites.Selected` `write` grant on the private Fee Proposals channel's own site allow app-only folder creation and upload there, and does a KR staff member who is not a channel member get no access to it?               | Verified 29 Oct per Slack (23/23): Fee Proposals privacy confirmed                                                                                   |
| V7  | Is delta supported only at the drive root on SharePoint, and does it work with `Sites.Selected`? (Phase 2 input.)                                                                                                                | Verified 29 Oct per Slack (23/23); WP-26 re-confirms delta scope (102 folder vs drive root) in its first integration test against the real test team |
| V8  | Do `Channel.Create` and `Channel.ReadBasic.All` (application) allow app-only creation and listing of standard channels? Current per-team channel limit and deleted-name reservation? (Phase 3 input.)                            | Verified 29 Oct per Slack (23/23); WP-27 re-confirms the per-team channel limit and deleted-name reservation before go-live                          |

## Open questions for KR (answered 2026-11-06; see the amendment below)

1. **Channel naming (phase 3):** is `S-<job number>_<ADDRESS, SUBURB IN CAPS> (<client>)` the format to generate, and
   who shortens the client? What happens when a job number contains `/` or the job is renamed or archived?
2. **Admin consent and team details:** a KR Global Administrator consents `Sites.Selected` in staging and production and
   grants `write` on the "Team Survey" site and the Fee Proposals channel's site. KR IT supplies the team id and both
   site URLs, confirms job channels are standard channels, and provides a test tenant or test team for the spike.
3. **System of record:** the bucket keeps the authoritative copy until phase 2. Acceptable for objective 3?
4. **Existing files at link time:** copy every existing clean file (default), or only files added after linking?
5. **Existing job list:** KR has the job names to set up; Andrew will send them to seed and check the hand links.

## Compliance check

- Unit and mutation tests on the domain rules: folder plan, sync policy (1.0 never pushed into a job channel), link
  parser, push selection. Integration tests against a local Graph fake: idempotent re-runs, `Retry-After`, upload
  session, no `Authorization` header on the upload URL. Authz matrix rows.
- Config tests refuse `TEAMS_CLIENT_SECRET` outside the worker schema and non-Microsoft base URLs in staging and
  production.
- railway.md E13–E16 and a staging go-live check are recorded before KR turns the flag on in production.

## Amendment 2026-11-06: all three phases, admin-held Teams settings

Decided by Craig (KR Surveys) on 6 Nov 2026 in the development chat, with one developer on the project. The 30 Oct
rule applies: no PR approvals; Craig merges once CI is green. This amendment answers the open questions above and
replaces the decisions below where they differ. Everything not mentioned stands as written.

### A1. Scope: build phases 1, 2 and 3 now

Option G ("all three phases at once") was rejected on 27 Oct for risk. Craig accepted that risk on 6 Nov: the three
phases are built in sequence as three work packages, WP-25 (phase 1 plus settings), WP-26 (phase 2) and WP-27
(phase 3), each still a stack of PRs ≤ 400 changed lines, each behaviour behind the same flag and the admin switch
(A2), each phase usable on its own. Phase 2 and 3 no longer need "their own amendment"; this is it.

### A2. The team is an admin setting, not an environment variable

So that KR can test against a test team and then point the app at the live team without a redeploy:

- A singleton table `teams_settings` holds: `team_id` (the Microsoft 365 group id), `team_site_url`, `team_name`
  (display only), `fee_channel_id`, `fee_site_url`, `sync_enabled` (default false), `inbound_sync_enabled`
  (phase 2, default false), `create_channels_enabled` (phase 3, default false), `fee_proposal_policy`
  (`exclude` | `restricted`, default `exclude`), `root_folder` (default `102. Subdivision Tracker`),
  `inbound_poll_seconds` (default 300, min 60), `updated_by/at`, `version`. One row, created by migration 0005.
- A new page **Admin → Teams** (`/admin/teams`, admin only, MFA step-up like `/admin/users`) edits it. New global
  capability `teams.settings.manage` (admin only; kr_admin reads via `teams.settings.read`). Saves are audited
  (`settings.teams_updated`, field changes recorded) and use `If-Match`.
- `TEAMS_TEAM_ID`, `TEAMS_SITE_URL`, `TEAMS_FEE_CHANNEL_SITE_URL`, `TEAMS_ROOT_FOLDER` and `TEAMS_FEE_PROPOSAL_POLICY`
  are **removed from the plan of record**. The worker keeps only what identifies it to Microsoft: `TEAMS_TENANT_ID`,
  `TEAMS_CLIENT_ID`, `TEAMS_CLIENT_SECRET` (sealed, worker only, decision 2 unchanged), `TEAMS_GRAPH_TIMEOUT_MS`, and
  the pinned base URLs. The api reads `teams_settings` to validate links and to answer the panel; the worker reads
  it at the start of every `teams.*` operation (never cached across operations).
- `Sites.Selected` is granted per site, so changing the team only works after KR IT has granted the worker's
  registration `write` on the new team's site (railway.md E15). **Test connection** on the settings page queues a
  `teams.check` operation; the worker reports, per item, pass/fail with the Graph error code: token obtained, team
  site resolvable, `write` on the team site (creates and deletes a probe folder under the root folder), fee channel
  site resolvable and writable, channel listing allowed (phase 3), channel creation permission present (phase 3,
  probe by listing only, no channel is created). Results are stored on the operation and shown on the page.
- Existing links are keyed by `(team_id, channel_id)` and are **not** touched when the team setting changes: jobs
  linked to channels in the test team keep syncing there until an admin relinks them. Phase 3 creates channels in
  whichever team is set at the moment of creation.
- The flag `teams-file-sync` (`FEATURE_TEAMS_FILE_SYNC`, api and worker, default off) stays as the deploy-time kill
  switch that makes the feature exist at all (routes, panel, settings page, worker handlers). Operation is switched
  by `sync_enabled` on the settings page, which is what KR uses day to day. "Flag off ⇒ nothing changes" in decision
  12 becomes "flag off **or** `sync_enabled=false` ⇒ nothing changes": routes under `/v1/jobs/{jobId}/teams-link`
  answer 404 and the panel is hidden when the flag is off; when only `sync_enabled` is off, the panel shows "Teams
  sync is turned off" to admins, nothing is queued and queued work completes as a no-op. `/admin/teams` is reachable
  whenever the flag is on.

### A3. Phase 1 decisions confirmed

- Existing files at link time: every existing clean file is copied (open question 4, the default).
- Fee proposals: decision 10 unchanged; `fee_proposal_policy` moves to the settings page (A2).

### A4. Phase 2 rules (Teams → app)

- The worker polls each linked job's root folder with Graph delta (no webhooks, no public endpoint), every
  `inbound_poll_seconds`, one job at a time, honouring `Retry-After`; operation `teams.poll`, scheduled by a sweep.
  If delta proves usable only at the drive root (V7), one delta per drive is filtered by path; the table below is the
  same either way.
- A new item under a recognised stage/checkpoint or condition-evidence folder is downloaded into the bucket and
  goes through the normal pipeline (type sniffing, ClamAV, parsing for 4.2/4.3/5.0 as if uploaded) and attaches to
  that checkpoint slot (the slot of the folder; where a checkpoint has several slots, the first slot that accepts
  the file's kind) or condition. `files.uploaded_by` is NULL and `files.source = 'teams'`; the audit entry is
  `file.teams_imported` (system) with the Teams `lastModifiedBy` display name as text.
- An item in a folder the app does not recognise (anything inside the root folder that is not a layout folder, or a
  file at the root itself) goes on the job's **Unfiled** list (`teams_inbound_items.status = 'unfiled'`). Staff
  choose a checkpoint or condition for it (then it is imported as above) or dismiss it (stays in Teams, hidden
  from the list, re-shown if it changes). Externals never see the Unfiled list.
- **Edited in Teams** (same item id, new `eTag`): the app stores the new content as a new file row; the previous
  row is soft-deleted with `deleted_reason = 'teams_replaced'` and keeps its storage until the 30-day purge. The
  push row moves to the new file.
- **Deleted in Teams** (delta `deleted` facet): the app keeps the file and sets `files.teams_removed_at`; the
  tracker shows "Removed in Teams" on the file. Nothing is deleted in the app automatically.
- **Deleted in the app** (new in phase 2, reversing the additive stance of decision 7): the worker deletes the
  pushed drive item (`teams.push` with action `delete`), only when the stored `eTag` still matches; otherwise the
  item is left alone and the file shows "Changed in Teams; not removed there". Replacing a file in the app pushes
  the new file and deletes the old item by the same rule.
- An inbound file that fails scanning is quarantined exactly like an upload (`scan_status = 'infected'`, never
  served) and flagged "Blocked: malware found in a file added in Teams" on the job page and in the audit trail; the
  Teams item is not deleted. Files larger than the upload limit, or of a kind the app refuses, stay in Teams and
  appear on the Unfiled list with the reason.
- The bucket remains the system of record. Items the app itself pushed are recognised by stored drive item id and
  are not re-imported.

### A5. Phase 3 rules (the app creates the channel)

- Create job gains a **Create Teams channel** checkbox, shown when the flag, `sync_enabled` and
  `create_channels_enabled` are on, checked by default, available to anyone with `jobs.create` (the link that
  results is the same as a hand link by an admin; the audit records the creator).
- Channel name: `S-<job number>_<ADDRESS, SUBURB IN CAPS> (<client>)` with these rules (open question 1):
  `/` in the job number becomes `-`; the address is upper-cased; characters Teams refuses in channel names are
  dropped; if the result is longer than 50 characters (the Teams limit; V8 re-check), the client part is shortened
  first to keep the total at 50 with `…`, then the address. A pure function `channelNameFor(job)` in
  `@kr/workflow` presentation helpers is the only place that builds it.
- The api never calls Graph (decision 1) and the worker takes no inbound requests, so the name check and the picker
  read a **channel cache**: table `teams_channels` (`team_id`, `channel_id`, `display_name`, `folder_name`,
  `membership_type`, `seen_at`), refreshed by the worker (`teams.list_channels`, `Channel.ReadBasic.All`) every
  `inbound_poll_seconds` while `create_channels_enabled` is on, and on demand when the settings page's Test
  connection runs. Before the job is created the api checks the generated name against the cache; a match shows "A
  channel with this name already exists — choose a different job name" and the job is not created. The cache can be
  up to one poll old, so the race is also handled at creation time (below). If the cache is empty or older than one
  hour (the worker cannot reach Graph), the job is created without a channel and the panel shows "Channel not
  created: Teams did not answer. Create it from the panel." with a **Create channel** button.
- The worker creates a standard channel in the configured team (`teams.create_channel`), creates the three template
  folders `100. Initial SURVEY`, `101. Subdivison Process` (KR's spelling, kept deliberately), and the root folder,
  links the job and runs phase 1 provisioning. A name clash discovered at creation time (race) sets the link to
  `error` with code `channel_name_taken` and the panel offers Relink.
- Renaming or archiving a job does **not** rename, archive or delete the channel; the panel notes "Channel name is
  not updated when the job changes". A reused job number whose generated name clashes gets a numeric suffix
  ` (2)` at creation.
- The link dialog gains a **channel picker** listing the cache's standard channels by name (private and shared
  channels are not offered), with the paste field kept as the fallback; a stale cache cannot link a wrong channel
  because the stored id is validated by provisioning as in phase 1.
- New application permissions for the worker's registration: `Channel.Create` and `Channel.ReadBasic.All`
  (railway.md E17), consented by a KR Global Administrator in staging before production.

### A6. Consequences of the amendment

- Three work packages instead of one; WP-26 and WP-27 reuse WP-25's link, folder and push tables.
- New tables `teams_settings` (0005) and `teams_inbound_items` (0007); `job_teams_links.team_site_url` (0006, the
  team site at link time); new columns on `files` (`source`, `teams_removed_at`, `deleted_reason`) in 0007;
  operation types `teams.check` (0005), `teams.poll`, `teams.create_channel`, `teams.list_channels` (0007); table
  `teams_channels` (0007). All expand-only.
- The settings page and `teams.check` add an admin-facing diagnostic the plan did not have; KR IT's checklist
  (E13–E17) is unchanged except that the team id and site URLs are entered on the page, not in Railway.
- Risk accepted by Craig: inbound sync and channel creation ship before phase 1 has run in production for long.
  Mitigation: each phase has its own admin switch and can be turned off without affecting the earlier one.
