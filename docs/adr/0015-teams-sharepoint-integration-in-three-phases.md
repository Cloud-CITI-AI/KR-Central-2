# ADR-0015: Teams/SharePoint integration in three phases

- Status: proposed
- Date: 2026-10-27 (updated 2026-10-29 with KR's answers)
- Deciders: KR Surveys (Craig) — pending; drafted for review
- Drafted by: agent claude (orchestrator) for the launching human (Andrew Thurlow)
- Related: supersedes the "SharePoint/Teams folder sync" paragraph of ADR-0012; ADR-0006, ADR-0011, ADR-0013,
  ADR-0014; docs/spec/PRODUCT_SPEC.md §5.8, §13 row 4, §16; work package WP-25 (phase 1)

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
registration's secret and runs the calls. The spike script ran outside the repo (X2, X3); its output is summarised below. Any "no" on V1, V3, V4, V5 or V6 stops WP-25 until the plan of record is
revised and approved again.

| #   | Question                                                                                                                                                                                                                         | Result                                                                                                                                                                                                                                                                                                                                                                                                            |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| V1  | With only `Sites.Selected` and `write`, can an app-only token resolve the site by path, read its default drive, create folders, upload (simple and upload session) and read `createdBy.application.id`?                          | **Yes** (29 Oct 2026, test team). Site by path 200, default drive 200, folder create 201 (duplicate → 409 `nameAlreadyExists`), simple upload 201, 12 MiB upload session in 10 MiB chunks 201, duplicate upload → 409, `createdBy.application.id` = this app. Tenant root site refused (403).                                                                                                                     |
| V2  | Does `GET /teams/{team}/channels/{channel}/filesFolder` fail with `Sites.Selected` alone? Which least permission makes it work? (Phase 3 picker.)                                                                                | Not tested yet (phase 3 input).                                                                                                                                                                                                                                                                                                                                                                                   |
| V3  | Do channel links from current clients (new Teams desktop, web, `teams.cloud.microsoft`) carry the channel id, `groupId` and `tenantId`? Is the URL name the folder name? After a rename, does the folder keep its original name? | **Yes for Teams on the web** (29 Oct). "Get link to channel" gives `https://teams.cloud.microsoft/l/channel/19%3A…%40thread.tacv2/<channel name>?groupId=<team id>&tenantId=<tenant id>`: it carries the channel id, `groupId` and `tenantId`, and the URL-decoded name equals the channel folder name the spike resolved. Not checked: the desktop app (not installed) and folder naming after a channel rename. |
| V4  | Private and shared job channels: is the folder absent from the team site, so linking fails cleanly?                                                                                                                              | Not tested yet.                                                                                                                                                                                                                                                                                                                                                                                                   |
| V5  | Simple-upload size limit, upload-session chunk rules, path length, forbidden names and characters. Are `102. Subdivision Tracker` and the stage folder names (e.g. `02 WAPC Approval`) accepted as written?                      | **Yes, in part.** `102. Subdivision Tracker`, `01 Preliminaries`, `02 WAPC Approval`, `4.2 WAPC Application Conformed` and `Condition 12 evidence` accepted (201); a name with `:` refused (400 `invalidRequest`). Upload session with 10 MiB chunks works. Path length limit not tested.                                                                                                                         |
| V6  | Does a `Sites.Selected` `write` grant on the private Fee Proposals channel's own site allow app-only folder creation and upload there, and does a KR staff member who is not a channel member get no access to it?               | **Yes, in part.** With a `write` grant on the Fee Proposals channel's own site: site 200, drive 200, folder create 201, job subfolder + upload 201. The channel's files sit at the library root, not in a folder named after the channel. Pending: a team member outside the channel confirms they cannot see it.                                                                                                 |
| V7  | Is delta supported only at the drive root on SharePoint, and does it work with `Sites.Selected`? (Phase 2 input.)                                                                                                                | Not tested yet (phase 2 input).                                                                                                                                                                                                                                                                                                                                                                                   |
| V8  | Do `Channel.Create` and `Channel.ReadBasic.All` (application) allow app-only creation and listing of standard channels? Current per-team channel limit and deleted-name reservation? (Phase 3 input.)                            | Not tested yet (phase 3 input).                                                                                                                                                                                                                                                                                                                                                                                   |

## Open questions for KR

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
