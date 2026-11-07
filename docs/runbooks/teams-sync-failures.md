# Teams sync failures

The Teams/SharePoint integration (ADR-0015) copies clean files to each linked job's channel and, under the `restricted`
policy, fee proposals to the private Fee Proposals channel. It runs in the worker as `teams.provision`, `teams.push`
and `teams.check` operations against Microsoft Graph with the registration of railway.md E13–E16. Nothing here affects
the app's own copy of a file: the bucket stays the system of record (ADR-0011).

## Symptoms

- The job panel shows "Teams link needs attention: …" with a reason, or stays at "Setting up folders in Teams…".
- File badges "Not copied", or the panel's "failed" count grows; `kr.teams.pushes{result="failed"}` rises.
- `kr.teams.graph_requests{status_class="429"}` or `"5xx"` rises; log `circuit_state_changed{dependency=graph,to=open}`.
- Admin → Teams → Test connection shows a failed check with a code such as `403 accessDenied` or `401 invalid_client`.

## Dashboards

Dashboard 3 (worker: operations by type and status) for `teams.*`; the Graph request counter by status class.

## Diagnose (read-only)

1. Admin → Teams → **Test connection**. The first failed check names the layer: `token` = registration or secret
   (E13/E16); `team_site` = wrong site URL or site gone; `team_site_write` = no `Sites.Selected` grant on that site
   (E15); `fee_site*` = the same for the Fee Proposals channel's site.
2. For one job: `GET /v1/jobs/{jobId}/teams-link` (or the panel) gives `errorCode` and the counts. Codes:
   `channel_folder_missing` (private, shared, renamed or deleted channel: the folder named after the channel is not
   in the team site's library), `permission_denied` (E15), `graph_unavailable` (Graph down or throttling beyond the
   bound), `teams_not_configured` (team not set under Admin → Teams).
3. Failed copies: `SELECT file_id, status, attempts, error_code, remote_path FROM tracker.teams_file_pushes WHERE
job_id = '<job>' AND status IN ('failed','uploading') ORDER BY updated_at;` (operator). `object_missing` means
   the file's object is gone from the bucket (it was removed or purged); `path_too_long` or `no_target_folder` mean a
   file the layout cannot place (a superseded condition's evidence, for example).
4. Logs: `teams_provision_failed`, `teams_push_failed` (with `code`, never a file name or URL), `teams_check_failed`.

## Mitigate

- **Throttling or an outage**: nothing to do. Pushes retry with back-off, then the hourly `teams_push_retry` sweep
  requeues every job with copies still due, up to 5 attempts per file. A long outage leaves rows `failed`; once Graph
  is back the sweep picks them up.
- **Missing grant** (`403 accessDenied` / `permission_denied`): KR IT runs E15 for that site. Then open the job and
  press **Relink** (the same channel link is fine) to provision again.
- **Wrong or renamed channel** (`channel_folder_missing`): confirm the channel is a standard channel of the configured
  team; relink with a fresh "Get link to channel". A renamed channel keeps its folder's original name, so the folder
  must be found under that name or the link relinked after KR renames the folder to match.
- **Expired secret** (`401 invalid_client` on the token check): rotate per `secrets-rotation.md` (E16), redeploy
  `worker`, press Test connection.
- **Stop copying** without losing anything: Admin → Teams → turn off **Copy files to Teams** (queued work completes
  as no-ops; files already in Teams stay). For an incident, set `FEATURE_TEAMS_FILE_SYNC=false` on `api` and
  `worker` and redeploy: every Teams route answers 404 and the worker creates no Graph client.
- **A file copied twice or to the wrong folder**: the app never deletes in Teams in phase 1; remove the extra item in
  Teams by hand. The push row keeps the item id and eTag of the copy the app made.

## Files added in Teams (phase 2)

With **Bring files added in Teams into the tracker** on, `teams.poll` runs for every linked job every "Check Teams
every" minutes and reads Graph delta under the job's root folder.

- **A file added in Teams does not appear**: it may be on the job page's **Files added in Teams that need filing**
  list (it sat at the root or in a folder the layout does not know), or still scanning. Items the app cannot bring in
  show why: too large, a file type the tracker never accepts, or malware found by the scan (the Teams item is left
  alone; tell KR to remove it there).
- **`teams_poll_finished` with `resynced: true`** means the delta token had expired (410); the worker listed the
  folder from scratch. Items already recorded by eTag are not imported twice.
- **Poll backlog** (`kr.operations.queue_depth{type="teams.poll"}` growing): the interval is shorter than the worker
  can serve for the number of linked jobs; raise "Check Teams every" under Admin → Teams.
- **Stop inbound only**: Admin → Teams → turn off Bring files added in Teams. Copies to Teams keep running.
- **Something deleted in Teams by mistake**: the tracker keeps its file and marks it "Removed in Teams"; nothing is
  needed. Something deleted in the tracker is removed from Teams only while the copy is unchanged there; a changed
  copy is left and the row shows "Changed in Teams; not removed there".

## Channels the app creates (phase 3)

With **Create channels for new jobs** on (E17 consented), creating a job queues `teams.create_channel`.

- **"Channel not created: Teams did not answer"** on the panel: the worker could not reach Graph or the channel
  cache was empty or older than an hour at creation time. Press **CREATE CHANNEL** on the panel once Graph is back.
- **"a channel with this name already exists"**: the team already had that name (the cache was stale, or two jobs
  share a number); link the existing channel by hand, or rename the job and press CREATE CHANNEL. Reused job
  numbers get " (2)" automatically only when the clash is known at creation time.
- **`403 Forbidden` on channel listing or creation** (Test connection shows "Can list channels" failing): E17 is
  missing or not consented; KR IT adds `Channel.ReadBasic.All` and `Channel.Create` (application) and consents.
- **The picker is empty**: the worker refreshes the cache every "Check Teams every" minutes while channel creation
  is on, and Test connection refreshes it at once. Paste a link meanwhile.
- The app never renames, archives or deletes channels; a renamed job keeps its channel name.

## Escalate

Open an incident (incident-response.md) if Graph answers `401`/`403` for every environment at once (a tenant-wide
change, consent revoked), if the Fee Proposals site becomes readable by non-members (privacy; stop with the policy set
back to `exclude` and tell KR IT), or if a file that is not `clean` ever appears in Teams (that would be an ADR-0011
breach: freeze the flag and preserve the operation rows and logs).
