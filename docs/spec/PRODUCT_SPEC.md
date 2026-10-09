# KR Subdivision Tracker — Product Specification

Status: draft for customer review · Owner: KR Surveys (Craig) · Drafted by: Claude (orchestrator) · Date: 2026-10-09

This document turns the "KR Subdivision Tracker" prototype (a single-file claude.ai artifact) into the specification for an
enterprise web application hosted on Railway. Behaviour, wording and look follow the prototype unless a section says
**Change** (a deliberate deviation, with the reason). Sources of truth, in order:

1. Customer requirements (Craig): Postgres + React, Railway, look as close to the prototype as possible, SSO to the KR
   Surveys tenant with the first user becoming admin, dashboard first, enterprise-grade, follow the agentic playbook.
2. The prototype source (`extracted.js`, `extracted.css`, 51 screenshots). Its embedded example job contains real client
   data and is **never** used in fixtures, seeds, tests or docs (playbook TD-1).
3. The prototype's "Developer notes" — they are requirements (§13).

Machine-readable companions: workflow definition `packages/workflow/src/definition.ts` (single source of truth for
stages/checkpoints/panels/slots), API contract `packages/contracts` (+ generated `openapi.yaml`), data model
`docs/spec/DATA_MODEL.md`, design tokens `docs/spec/DESIGN_TOKENS.md`. Decisions: `docs/adr/`.

---

## 1. Glossary

| Term             | Meaning                                                                                                                      |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Job              | One subdivision engagement, identified by a KR job number (e.g. `S-0001`).                                                   |
| Stage            | One of 10 collapsible groups of checkpoints (Preliminaries … Titles).                                                        |
| Checkpoint       | One of 46 workflow items. Has a display number (e.g. 12.3) and a storage key (e.g. `i13_2`) — they differ for 12 items (§7). |
| Status           | Completed / Not completed / Not required (wire values `completed`, `not_completed`, `not_required`).                         |
| Responsibility   | KR Surveys / Client / Architect / Unassigned (`kr`, `client`, `architect`, `null`).                                          |
| Effective status | Stored status, except checkpoints in an _excluded agency stage_ are always Not required.                                     |
| WAPC             | Western Australian Planning Commission. Form 1A = application, Form 1C = clearance request.                                  |
| Conformed date   | Date stamped on page 1 of the WAPC Conformance Notification; WAPC then has 90 days to decide (outcome date).                 |
| Decision Letter  | WAPC conditional approval letter; source of the numbered **conditions**, approval date and expiry.                           |
| Condition        | One numbered WAPC condition: text, agency, cleared tick, responsibility, KR comment, client comment, evidence files.         |
| Agency stages    | Western Power, Water Corporation, Local Government, Busselton Water (run in parallel).                                       |
| Grant            | Access manager entry giving an external person (client/architect) access to one job.                                         |
| Operation        | Asynchronous server task (decision-letter extraction, conformance read, email parse, malware scan).                          |

## 2. Users and roles

KR Surveys is a Microsoft 365 organisation. Everyone signs in with Microsoft Entra ID against the **KR Surveys tenant**
(ADR-0002). KR employees are tenant _members_; clients and architects are invited as Entra **B2B guests** of the tenant.

| Role       | Who                                                                                                                    | How assigned                                                                                     |
| ---------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `admin`    | System administrators (first user + whoever they promote). Implies everything `kr_admin` can do, plus user management. | First eligible sign-in (§3.3); later by an admin.                                                |
| `kr_admin` | "KR Admin (Alex, Ivan, Accounts)" — staff who may see fee proposals and the audit trail, archive jobs.                 | Admin promotes a staff user.                                                                     |
| `staff`    | KR employees. See and edit every job, manage access. **Cannot** see fee proposals (developer note 2).                  | Automatic on first sign-in for tenant members whose email domain is in `KR_STAFF_EMAIL_DOMAINS`. |
| `external` | Clients and architects (B2B guests), and any member outside the KR staff domains. No global access.                    | Automatic on first sign-in; job access only through grants.                                      |

Job-level grant roles for `external` users: `client`, `architect` (the prototype's access-manager roles; its third role
"KR Surveys staff – all jobs" is replaced by automatic staff detection — **Change**: staff access is derived from
tenant membership + domain, not from a list that anyone could be added to).

### 2.1 Permissions matrix (authoritative copy: `packages/contracts/src/permissions.ts`)

✓ = allowed, — = denied (API returns 403; for jobs the caller cannot see at all, 404).

| Capability                                                                                                  | admin    | kr_admin | staff                     | client (grant) | architect (grant)         |
| ----------------------------------------------------------------------------------------------------------- | -------- | -------- | ------------------------- | -------------- | ------------------------- |
| See dashboard / job list                                                                                    | all jobs | all jobs | all jobs                  | granted jobs   | granted jobs              |
| Create job, edit job details & WAPC dates                                                                   | ✓        | ✓        | ✓                         | —              | —                         |
| Archive (soft-delete) job                                                                                   | ✓        | ✓        | —                         | —              | —                         |
| Change checkpoint status / responsibility / KR note                                                         | ✓        | ✓        | ✓                         | —              | —                         |
| Record client decision (approve/accept/decline)                                                             | ✓        | ✓        | ✓ (on client's behalf)    | ✓              | —                         |
| Press client response button (INVOICE PAID, WORKS COMPLETE …) and Undo                                      | ✓        | ✓        | ✓                         | ✓              | —                         |
| View fee proposal (1.0) panel and its files                                                                 | ✓        | ✓        | —                         | ✓              | —                         |
| Upload into "staff" slots                                                                                   | ✓        | ✓        | ✓                         | —              | —                         |
| Upload into "staff + client" slots (letter of consent 3.0, Notice of Completion 6.6, plumber documents 7.3) | ✓        | ✓        | ✓                         | ✓              | —                         |
| Upload condition evidence                                                                                   | ✓        | ✓        | ✓                         | ✓              | ✓                         |
| Remove any file                                                                                             | ✓        | ✓        | ✓                         | —              | —                         |
| Remove own uploads                                                                                          | ✓        | ✓        | ✓                         | ✓              | ✓                         |
| Extract conditions / re-read conformed date / add query emails                                              | ✓        | ✓        | ✓                         | —              | —                         |
| Edit condition tick, responsibility, agency, KR comment                                                     | ✓        | ✓        | ✓                         | —              | —                         |
| Edit condition client comment                                                                               | ✓        | ✓        | ✓                         | ✓              | ✓                         |
| Add job notes                                                                                               | ✓        | ✓        | ✓                         | ✓              | ✓                         |
| Delete any note / own note                                                                                  | any      | any      | any                       | own            | own                       |
| Download job package (.zip)                                                                                 | ✓        | ✓        | ✓ (no fee proposal files) | ✓              | ✓ (no fee proposal files) |
| Access manager (grant/revoke)                                                                               | ✓        | ✓        | ✓                         | —              | —                         |
| User management (roles, disable)                                                                            | ✓        | —        | —                         | —              | —                         |
| Audit trail                                                                                                 | ✓        | ✓        | —                         | —              | —                         |

Rules: deny by default; every handler checks explicitly (BE-5); object-level checks on every job-scoped request
(the job must be visible to the caller — externals only through an **active** grant); disabled users have no access;
role or status changes revoke the user's sessions (session rotation on privilege change, docs/07 §7.4).

## 3. Authentication and session

### 3.1 Sign-in flow (ADR-0002)

1. Unauthenticated request to any page → redirect to `/sign-in` (branded page: KR hero header, "Sign in with
   Microsoft" button, short privacy note). Deep links keep `returnTo` (same-origin path only).
2. Button → `GET /api/v1/auth/login?returnTo=…` → 302 to Entra authorize endpoint
   (`https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize`) with `response_type=code`, PKCE S256, `state`,
   `nonce`, scopes `openid profile email`. State/nonce/verifier are stored server-side (`auth_flows`, 10-minute TTL).
3. Entra redirects to `GET /api/v1/auth/callback`. The API validates state, exchanges the code (confidential client:
   client secret + PKCE), validates the ID token with `openid-client` (signature via tenant JWKS, `iss` =
   `https://login.microsoftonline.com/{tenant}/v2.0`, `aud` = client id, `nonce`, `exp`/`iat`, and `tid` = configured
   tenant). No hand-rolled token parsing (SC-B4).
4. User upsert keyed by (`tid`, `oid`). Display name from `name`; email from `email`, else `preferred_username`
   (lower-cased); `isGuest` from the `acct` claim (1 = guest) — the app registration must emit optional claims `email`,
   `acct` (deploy guide).
5. New session: 256-bit random id in cookie `__Host-kr_session` (HttpOnly, Secure, SameSite=Lax, Path=/), SHA-256
   stored in `sessions`; idle timeout 120 min (sliding), absolute 12 h (configurable); CSRF token per session.
6. Pending grants whose email equals the user's email are activated (bound to the user id) — §3.4.
7. Redirect to `returnTo` (default `/`, the dashboard). Errors → `/sign-in-error?reason=<code>` with a friendly
   message (cancelled, wrong tenant, account disabled, no access, expired attempt). Security events are logged
   (authn success/failure, with pseudonymised identifiers only).

Sign-out: `POST /api/v1/auth/logout` revokes the session, clears the cookie and returns Entra's end-session URL; the
browser navigates there (`post_logout_redirect_uri` = `/signed-out`).

MFA for admins (docs/07 §7.4) is enforced in Entra via Conditional Access (deploy guide). The API records `amr`/
`auth_time`; when `amr` lacks `mfa` for an `admin`/`kr_admin` session, user-management and audit endpoints return 403
with problem type `forbidden` and detail "Multi-factor sign-in required" (configurable `REQUIRE_MFA_FOR_ADMIN`,
default true in production).

### 3.2 CSRF and same-origin

The browser only talks to the web origin; the Next.js app proxies `/api/v1/*` to the API over Railway private
networking (ADR-0005). State-changing requests require `X-CSRF-Token` (from `GET /v1/me`) **and** an `Origin` header
equal to `PUBLIC_BASE_URL`. SameSite=Lax blocks cross-site POSTs as a second layer.

### 3.3 First user becomes admin (ADR-0003)

The first _eligible_ user to complete sign-in becomes `admin`: a tenant member (`acct`=0) whose email domain is in
`KR_STAFF_EMAIL_DOMAINS`. Guests are never eligible, so an invited client cannot become admin by signing in first.
Race safety: inside the sign-in transaction the API runs
`INSERT INTO system_bootstrap (first_admin_user_id) VALUES ($user) ON CONFLICT DO NOTHING RETURNING …`; only the
transaction that gets a row back sets the user's role to `admin`. The singleton primary key makes concurrent first
sign-ins safe without application locks. The event is audited (`user.first_admin_assigned`).

Recovery: if the only admin leaves, an operator can run `node services/api/dist/cli/promote-admin.js <email>` from a
Railway one-off shell (audited). The API refuses to demote or disable the last active admin.

### 3.4 External users (clients, architects)

- KR staff add a grant in the access manager: email, optional name, role (client/architect), job. Status "Pending".
- Optional (`FEATURE_ENTRA_GUEST_INVITES`, default off): the API also sends an Entra B2B invitation via Microsoft Graph
  (`POST /invitations`, application permission `User.Invite.All`, redirect URL = the app). Without the flag, KR IT
  invites the guest in Entra and the UI says so (**Change** from the prototype's "access will be sent once the tracker
  moves to its own website").
- When a guest signs in and their email matches pending grants, the grants become "Active" and bind to that user id
  permanently (a later email change does not move access). A guest with no active grant sees an empty dashboard with
  "You don't have access to any jobs yet — ask your KR Surveys contact."
- Revoking a grant takes effect on the user's next request (job visibility is checked per request).
- Matching is case-insensitive on the full email. Only grants whose job is not archived activate.

## 4. Pages and navigation

| Route                | Page                                                                                                                         | Who             |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------- | --------------- |
| `/sign-in`           | Branded sign-in (hero header, "Sign in with Microsoft").                                                                     | Public          |
| `/sign-in-error`     | Friendly error + "Try again".                                                                                                | Public          |
| `/signed-out`        | "You have signed out" + sign-in link.                                                                                        | Public          |
| `/`                  | **Dashboard** — first page after sign-in (§6).                                                                               | Signed in       |
| `/jobs/{jobId}`      | **Tracker** for one job (§5). Query `?stage=<stageKey>` opens and scrolls to a stage; `#checkpoint-<key>` scrolls to a card. | Job visible     |
| `/admin/users`       | User management: list, search, change role, disable/enable (§9.1).                                                           | admin           |
| `/admin/audit`       | Audit trail with filters (job, user, action) (§9.2).                                                                         | admin, kr_admin |
| Document viewer      | Modal dialog over the tracker (§8.4).                                                                                        | Job visible     |
| `not-found`, `error` | Branded 404/500 with request id.                                                                                             | —               |

Shell (every signed-in page): the prototype hero header (KR logo, "SUBDIVISION TRACKER" tag, H1 "KR SURVEYS
SUBDIVISION TRACKER", orange rule, "Keeping you up to date with your subdivision"). **Additions** in the hero bar's right
side (replacing nothing): signed-in user's display name, a theme control (System / Light / Dark), an "Admin" link for
admins, and "Sign out". Footer text as prototype, with the accepted-types sentence generated from server limits.

Navigation: Dashboard → "Open job →" or job picker → Tracker. Tracker jobbar has the job picker (`<select>` grouped
"In progress (n)", "Complete (n)", sorted by job number), a **DASHBOARD** primary button and **Save as PDF**.
Dashboard jobbar has **← BACK TO TRACKER** (returns to the last opened job, remembered in localStorage) and Save as PDF.
Browser back/forward and deep links work (real routes — **Change** from the prototype's single-page view toggle).

## 5. Tracker page (`/jobs/{jobId}`)

Layout top to bottom, 1180 px max width (screenshots `*-01`, `*-02`, `*-03`). All texts below are exact.

### 5.1 Jobbar and banner

- Label "JOB", job picker (full-width flex), **DASHBOARD** (primary), **Save as PDF** (secondary, title "Saves exactly
  what is showing – use Expand all first to include everything" — **Change**: uses the browser print dialog with a
  print stylesheet; "Save as PDF" expands all stages before printing and restores afterwards).
- Banner (accent-soft background) for: read-only access ("You have view-only access to this tracker, so changes can't be
  saved." — shown to architects), save failures ("A change couldn't be saved. Reload the page and try again." with
  request id), stale data (412: "Someone else changed this — the latest version has been loaded."), connectivity loss.

### 5.2 Summary panels

Two panels side by side (stacked < 760 px):

- **SUBDIVISION PROGRESS**: progress ring (78 px conic gradient, % = round((completed + not required) / 46 × 100)),
  stacked bar (green completed / grey not required / red not completed; aria-label "C completed, X not required, N not
  completed of 46"), count chips "20 Completed", "15 Not completed", "11 Not required". Below a rule: date inputs
  **WAPC APPROVAL DATE** and **APPROVAL EXPIRY**; under expiry: "768 days left to lodge Form 1C" (green ≥ 180 days,
  amber < 180, red when past: "Expired 3 days ago"). When both empty: "Filled in automatically when conditions are
  extracted from the Decision Letter in 5.0". Editable by `job.edit`; read-only otherwise.
- **STATUS KEY**: swatches Completed / Not completed / Not required, and tags "ITEM KR progress claim", "$ KR payment",
  "$ Client payment".

### 5.3 Stages

"STAGES" label with **Expand all** / **Collapse all**. Ten stage bars (button, `aria-expanded`, `aria-controls`):
chevron, upper-case name, meta "N to do" / "Complete" / "Not required", 90 px track, percentage. Colour from stage
state (red if any open, green if any completed and none open, grey otherwise). Open/closed state persists per browser
(localStorage `kr-wf-open`). An **excluded agency stage** renders as a disabled grey bar "Not required – no conditions
in the Decision Letter" (title "The Decision Letter has no conditions for <agency>") and cannot be opened.
Links like "Go to Western Power ↓" and "Checklist ↑" open the target stage and scroll to it (smooth unless reduced
motion).

Inside each agency stage (and WAPC), when that agency has conditions, a **"WAPC conditions – <agency>"** evidence box
is shown first (§5.6). The WAPC Approval stage renders the **outcome box** after 4.2 (§5.5).

### 5.4 Checkpoint card (common)

Grid: main column + 300 px control column (single column < 760 px). Background/border by **effective** status.

- Title row: number (tabular, grey), title, status label at right ("COMPLETED" etc.).
- Description (grey), indented to the title.
- Tags: claim (`ITEM 2 PAYMENT REQUIRED`), fee (`$ WAPC Form 1A payment`, yellow = client pays, blue = KR pays).
- Panels (by type, §5.5) in the order of the workflow definition.
- Control column: segmented status buttons (Completed / Not completed / Not required, `aria-pressed`) and the
  responsibility select (Unassigned / KR Surveys / Client / Architect). Disabled without the capability. Changes save
  immediately (optimistic UI; on failure revert + banner). Checkpoints in an excluded stage are not rendered.
- Restricted (fee proposal) for viewers without `fee_proposal.view`: title, number, status and controls render, panel
  content is replaced by "Fee proposal details are visible to KR Admin and the client only." Files are not listed.

### 5.5 Panel types

Each panel is a white box indented under the title (0 indent < 760 px). Folder header: folder icon, bold title, count
("2 files", "empty", "not received yet", "2 files received"), optional "Open all" (opens the viewer on the first file).
Document rows: extension badge (PDF/DWG/JPG…), file name (opens viewer), remove "×" with inline "Remove? Yes / No"
confirm. Drop zones: dashed box, bold label, hint; drag-and-drop and click-to-choose (`<input type=file multiple>`
visually hidden, keyboard focusable, labelled); "Uploading…" while uploading; per-file errors listed under the card
("<name> is larger than 50 MB", "<name> isn't a supported type for this box (use PDF or photo)"). Files show
"Scanning…" until the malware scan finishes; infected files show "Blocked – failed the virus scan" and cannot be opened.

| Panel                   | Behaviour                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `approval`              | Optional folder ("Fee proposal documents" / "Quote documents") with drop zone "Drag and drop <noun> documents here" — "or click to choose files"; when empty and the viewer cannot upload, the folder hint is shown. Optional extra slot (3.0 "Completed letter of consent", "Drag and drop the completed letter of consent here" — "or click to choose a PDF or photo of the signed letter"). Decision area (label "Client decision" or "Client response"): buttons "<Yes> <noun>" (green) and "Decline <noun>" (red) → inline form "Approve the fee proposal" / "Decline the quote" with textarea (placeholder "Comment (optional)" / "Reason for declining (required)"), "Confirm approval"/"Confirm acceptance"/"Confirm decline" + "Cancel". Decline without comment → "Add a comment explaining why it is declined." and focus returns to the textarea (server enforces too). Result box: "Client approved the WAPC proposal 28 Sep 2026" (green) or "Client declined the quote" (red) with the comment in quotes, and "Change" (re-opens the form pre-filled). A decision does **not** change the status (prototype behaviour). |
| `paid`                  | Label ("Client response"/"Client decision") and one green button (e.g. "INVOICE PAID", "WORKS COMPLETE", "FEE PAID", "QUOTE PAID", "TITLES OBTAINED"). Pressing records the time and sets the status to Completed. Done state: "Invoice paid 28 Sep 2026" + "Undo" (clears it and sets Not completed).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `kr_note`               | Labelled textarea "KR Surveys comment – what the client needs to pay" (placeholder "e.g. Development contribution of $X payable to the Shire – invoice attached"); autosaves 700 ms after typing stops and on blur; read-only for clients.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `documents`             | Single titled drop area (e.g. "Water Corporation Agreement" — "Drag and drop the Water Corporation Agreement PDF here" — "PDF – or click to choose"). Variant `photos` (11.0) shows a thumbnail grid (96 px, 4:3) that opens the viewer on click and "View all"; hint "JPG, PNG or WebP photos – drop several at once, or click to choose".                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `survey` (2.0)          | Chips "PDF required"/"✓ PDF received" and "DWG required"/"✓ DWG received"; drop zone "Drag and drop the feature survey PDF and DWG here" — "both files are required – or click to choose"; accepts only PDF and DWG. **Change**: DWG is stored as-is (no JSON wrapping) and downloaded directly; size limit is the global upload limit.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `slots`                 | Requirement chips per slot, then one sub-folder per slot (upper-case slot title, files, drop zone), then "Other files" for files whose slot no longer exists. 6.8 (Clearance PDF + Clearance email (as PDF)), 7.3 (Certificate of Completion + As-Con / Flimsy, PDF or photo).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `clearance`             | "<Agency> clearance" folder, "Open all" when > 1 file, drop "Drag and drop the <Agency> clearance here" — "PDF or image – or click to choose".                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `conformance` (4.2)     | "Conformance Notification" folder ("not received yet"), drop zone (PDF only, hint "PDF – the conformed date is taken from the file name, or read from the stamp on page 1"). Uploading a PDF starts a conformance read (§10.1); while running the zone says "Reading the conformed date…". Button(s) "Read conformed date again" / "Read date from <file>". Result message under the zone.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| outcome box (after 4.2) | Two dates: **Conformed date** (hint "Stamped date on page 1 of the Conformance Notification" / "Read from <file>" / "Entered by hand") and **WAPC outcome date** (hint "90 days after the conformed date" or "Changed by hand (e.g. deferral)" with "· reset to 90 days"). Setting the conformed date by hand sets outcome = +90 days. Right side: live countdown (days/hrs/min/sec tiles; amber < 14 days; red and "Outcome date passed – Sun, 26 Oct 2025" when past) or "Drop the Conformance Notification in 4.2, or enter the conformed date, to start the countdown". Countdown ticks every second client-side; `role="timer"`, `aria-live="off"`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `emails` (4.3)          | "Query emails" folder ("none yet" / "2 emails"); list of emails (subject as link → viewer shows the rendered text; meta "From · 28 Sep 2026, 3:50 pm"; remove). Drop zone "Drop a WAPC query email here" — "Drag an email from Outlook, or click to choose a .msg / .eml file". Dropping plain text (no files) adds a pasted email (subject = first line, 90 chars). Non-email files are rejected ("<name> isn't an email – drop an Outlook message (.msg) or .eml file, or use Upload for other documents"). **Change**: parsing happens server-side in the worker; the original .msg/.eml is kept.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `conditions` (5.0)      | "WAPC conditional approval" folder (PDFs; drop "Drag and drop the WAPC conditional approval PDF here" — "then extract its conditions"). For each PDF whose name contains "decision": button "Extract conditions from Decision Letter" (or "Re-extract …", or "Extract conditions – <file>" when several). If conditions exist, confirm "Replace the N existing conditions, including their ticks, comments and evidence?" Replace / Cancel. If PDFs exist but none named "decision": "Conditions can only be extracted from the Decision Letter – upload it with "Decision Letter" in the file name." Messages: guessed agencies, no conditions found, unreadable PDF (§10.2). Then the **Conditions checklist** (`<details>`, open by default, "5 of 13 cleared") with one condition card per condition (agency select + "Agency is correct" when guessed, "Agency guessed – please check" badge, "Go to <agency> ↓"), and footer "Extracted from <file> · changes here and in each agency section update each other".                                                                                                                |

### 5.6 Condition card

Header: "Condition N", agency (select in the checklist; plain badge in agency sections), guessed badge, link. Text
(struck through when cleared). Editor row: checkbox + "Open"/"Cleared", "RESPONSIBILITY" select (Unassigned / KR
Surveys / Client). Two textareas side by side (stacked < 640 px): "KR Surveys comment", "Client comment" — autosave
700 ms after typing and on blur, never re-rendered under the cursor. Evidence: file rows + small drop zone "Drop
clearance evidence here" — "photos, stat dec, approvals – or click to choose". Card background red (open) or green
(cleared). The same condition appears in the 5.0 checklist and in its agency stage; edits in one place show in the
other immediately (single source).

### 5.7 Job notes

Section "JOB NOTES" — "Any notes relevant to the subdivision. Any party can post a note." Textarea, select "For:
Everyone / Surveyor / Client" (label only — everyone on the job can read every note), **ADD NOTE**. List newest first:
date-time, "FOR CLIENT" chip, "by you" / "by <name>", delete × with "Delete?" confirm (own notes, or staff any). Empty:
"No notes on this job yet." Empty submit: "Type a note first." Notes paginate (load more) after 50.

### 5.8 Job files

Section "JOB FILES" — "18 files across the stages above" / "No files uploaded to this job yet", button **DOWNLOAD ALL
FILES (.ZIP)** (disabled when 0). The server streams a zip named "<job number> – subdivision files.zip" with top folder
"<job number> – <address>", one folder per stage ("02 WAPC Approval"), sub-folder per checkpoint ("4.3 Queries from
WAPC", emails in "/Query emails"), condition evidence under "<stage>/WAPC conditions/Condition N evidence", duplicate
names suffixed " (2)", and "Job summary.txt" (job line, download time, conformed/outcome dates, every stage with each
checkpoint's status, conditions with comments, job notes). Only clean/skipped files; restricted files only for viewers
with `fee_proposal.view`.

### 5.9 Removed from the prototype

"Developer notes (TEMPORARY)" is not built — the prototype says to remove it before going live; its five notes are
requirements (§13). The offline-export banner and read-only export mode are not built.

## 6. Dashboard (`/`)

Screenshots `*-11`, `*-14`, `*-17`. Visible to everyone signed in; externals see only their granted jobs.

- Header box "SUBDIVISION DASHBOARD": segmented filter **In progress (n) / Complete (n) / All (n)** (pressed = dark),
  search box "Search job, address or client" (matches job number, address, client name; case-insensitive), and type
  chips "TYPE All types n · Survey-Strata n · Built Strata n · Amalgamation n · Freehold n · Strata Conversion n ·
  Re-Subdivision n" (counts within the status filter; clicking the active chip clears it).
- **New job** (staff): button **NEW JOB** in the header opens an inline form (styled like the prototype's
  `form.newjob`): Job number, Address, Client (optional), Subdivision type (select), **CREATE JOB**, Cancel. On success
  navigate to the new tracker. Duplicate number → "S-0001 is already in use." (**Addition** — the prototype imported
  jobs from KR's project tracker.)
- Summary chips: "n In progress", "n Complete", "n Waiting on client" (open jobs whose next action is the client's),
  "n Need attention" (jobs with alerts).
- Cards grid (min 290 px): job number, state chip IN PROGRESS / COMPLETE, %, address, "client · type", mini progress
  bar, "NEXT TO ACTION" box with alerts (red "bad", amber "warn") then up to 4 next actions ("8.0 Submit for clearance
  [KR Surveys]"; responsibility chip blue KR / yellow Client / grey Unassigned), "+ n more stages with open items",
  complete jobs: "All done" / "Plan in order for dealings – nothing left to action.", fallback "Everything open is
  marked – check 12.3 Plan in order for dealings.". **Open job →**. Sorting: most alerts first, then job number.
  Empty: "No jobs match." Paginated (load more) at 50 cards.
- **ACCESS MANAGER** (staff only; hidden for externals — developer note 1): description text adapted ("Add the people
  who should be able to view a job – choose the job from the list. KR Surveys staff see all jobs automatically."), form:
  email, name (optional), role (Client – sees their own job / Architect – sees their own job), job picker grouped In
  progress / Complete, **GRANT ACCESS**. Validation: "Enter a valid email address, e.g. name@example.com.", "Choose
  which job they should see.", duplicate "x@y.z is already on the list for S-0001.". List sorted by job then email: name
  `<email>`, job chip, role, status chip PENDING / ACTIVE (+ invitation sent/failed), remove × with "Remove? Yes/No".
  Success message: "x@y.z added – they get access when they sign in with that email." (+ "An invitation email has
  been sent." when guest invites are on). Empty: "No one has been added yet."

## 7. Workflow definition (all 46 checkpoints)

Generated from `packages/workflow/src/definition.ts` (the source of truth — update both together; a unit test checks
counts and keys, an integration test checks the DB seed). "Default resp." is the responsibility a new job starts with.
Slots: `staff` = KR staff only; `staff+client` = staff and the job's clients.

#### Preliminaries

| #   | Key     | Title               | Default resp. | Tags                          | Panels (in order)                                                                                     | Upload slots (key: accepts — who)          |
| --- | ------- | ------------------- | ------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| 1.0 | `i1_0p` | Fee proposal        | Client        | RESTRICTED: fee proposal      | approval(fee proposal; "Approve"/"Decline"; folder "Fee proposal documents"; label "Client decision") | documents: pdf/image/video/text — staff    |
| 2.0 | `i2_0`  | Site Feature Survey | KR            | ITEM: Item 1 payment required | survey                                                                                                | survey: pdf/dwg — staff (requires pdf+dwg) |

#### WAPC Approval

| #   | Key     | Title                              | Default resp. | Tags                                 | Panels (in order)                                                                                      | Upload slots (key: accepts — who) |
| --- | ------- | ---------------------------------- | ------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------ | --------------------------------- |
| 3.0 | `i3_0p` | WAPC Proposal                      | Client        | —                                    | approval(WAPC proposal; "Approve"/"Decline"; + "Completed letter of consent"; label "Client decision") | consent: pdf/image — staff+client |
| 4.0 | `i4_0`  | WAPC Form 1A application lodged    | KR            | ITEM: Item 2 payment required        | status only                                                                                            | —                                 |
| 4.1 | `i4_1`  | WAPC Application Payment           | Client        | $ WAPC Form 1A payment (client pays) | paid("INVOICE PAID" → "Invoice paid"; label "Client response")                                         | —                                 |
| 4.2 | `i4_2`  | WAPC Application Conformed         | KR            | —                                    | conformance                                                                                            | conformance: pdf — staff          |
| 4.3 | `i4_3`  | Queries from WAPC                  | KR            | —                                    | emails                                                                                                 | email: email — staff              |
| 5.0 | `i5_0`  | WAPC conditional approval received | KR            | —                                    | conditions                                                                                             | decision: pdf — staff             |

#### Western Power (optional agency stage — auto-excluded when the Decision Letter has conditions but none for Western Power)

| #   | Key     | Title                                | Default resp. | Tags                             | Panels (in order)                                                                                      | Upload slots (key: accepts — who)         |
| --- | ------- | ------------------------------------ | ------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------- |
| 6.0 | `i6_0`  | Western Power connection application | KR            | $ WP connection fee (KR pays)    | status only                                                                                            | —                                         |
| 6.1 | `i6_1a` | Western Power Quote                  | Client        | —                                | approval(quote; "Accept"/"Decline"; folder "Quote documents"; label "Client decision")                 | documents: pdf/image/video/text — staff   |
| 6.2 | `i6_1`  | Quote acceptance with Western Power  | KR            | —                                | status only                                                                                            | —                                         |
| 6.3 | `i6_2`  | Western Power Invoice Payment        | Client        | $ WP quote (client pays)         | paid("Invoice PAID" → "Invoice paid"; label "Client decision")                                         | —                                         |
| 6.4 | `i6_4`  | Western Power Contractor             | KR            | ITEM: Item 3 payment required    | status only                                                                                            | —                                         |
| 6.5 | `i6_6`  | Western Power site work complete     | Client        | —                                | paid("WORKS COMPLETE" → "Works complete"; label "Client response")                                     | —                                         |
| 6.6 | `i6_7`  | Internal electrical work complete    | Client        | $ Electrician fees (client pays) | documents("Notice of Completion") + paid("WORKS COMPLETE" → "Works complete"; label "Client response") | notice_of_completion: pdf — staff+client  |
| 6.7 | `i6_8`  | Submit for clearance                 | KR            | —                                | status only                                                                                            | —                                         |
| 6.8 | `i6_9`  | Western Power clearance received     | KR            | —                                | slots("Western Power clearance")                                                                       | clr: pdf — staff<br>clremail: pdf — staff |

#### Water Corporation (optional agency stage — auto-excluded when the Decision Letter has conditions but none for Water Corporation)

| #   | Key    | Title                                | Default resp. | Tags                                      | Panels (in order)                                              | Upload slots (key: accepts — who)                                |
| --- | ------ | ------------------------------------ | ------------- | ----------------------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------- |
| 7.0 | `i7_0` | Water Corporation agreement request  | KR            | —                                         | status only                                                    | —                                                                |
| 7.1 | `i7_1` | Water Corporation agreement received | KR            | —                                         | documents("Water Corporation Agreement")                       | documents: pdf — staff                                           |
| 7.2 | `i7_2` | Sewer junction cut-in                | Client        | $ Plumber fees (client pays)              | status only                                                    | —                                                                |
| 7.3 | `i7_3` | Sewer junction cut-in complete       | Client        | —                                         | slots("Plumber documents")                                     | coc: pdf/image — staff+client<br>ascon: pdf/image — staff+client |
| 7.4 | `i7_4` | Submit for clearance                 | KR            | —                                         | status only                                                    | —                                                                |
| 7.5 | `i7_5` | Water Corporation Invoice Payment    | Client        | $ Water Corporation invoice (client pays) | paid("Invoice PAID" → "Invoice paid"; label "Client response") | —                                                                |
| 7.6 | `i7_6` | Water Corporation clearance received | KR            | —                                         | clearance(Water Corporation)                                   | clearance: pdf/image — staff                                     |

#### Local Government (optional agency stage — auto-excluded when the Decision Letter has conditions but none for Local Government)

| #   | Key    | Title                               | Default resp. | Tags                                  | Panels (in order)                                                                                                     | Upload slots (key: accepts — who) |
| --- | ------ | ----------------------------------- | ------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| 8.0 | `i8_2` | Submit for clearance                | KR            | $ Local Gov. clearance fee (KR pays)  | status only                                                                                                           | —                                 |
| 8.1 | `i8_3` | Additional Council Payments         | Client        | $ Other Local Gov. fees (client pays) | kr_note("KR Surveys comment – what the client needs to pay") + paid("FEE PAID" → "Fee paid"; label "Client response") | —                                 |
| 8.2 | `i8_4` | Local Government clearance received | KR            | —                                     | clearance(Local Government)                                                                                           | clearance: pdf/image — staff      |

#### Busselton Water (optional agency stage — auto-excluded when the Decision Letter has conditions but none for Busselton Water)

| #   | Key    | Title                                   | Default resp. | Tags                                 | Panels (in order)                                            | Upload slots (key: accepts — who) |
| --- | ------ | --------------------------------------- | ------------- | ------------------------------------ | ------------------------------------------------------------ | --------------------------------- |
| 9.0 | `i9_0` | Busselton Water – request for quotation | KR            | —                                    | status only                                                  | —                                 |
| 9.1 | `i9_1` | Quotation received                      | Client        | —                                    | approval(quote; "Accept"/"Decline"; label "Client response") | —                                 |
| 9.2 | `i9_2` | Quotation paid                          | Client        | $ Busselton Water fees (client pays) | paid("QUOTE PAID" → "Quote paid"; label "Client response")   | —                                 |
| 9.3 | `i9_3` | Submit for clearance                    | KR            | —                                    | status only                                                  | —                                 |
| 9.4 | `i9_4` | Busselton Water clearance received      | KR            | —                                    | clearance(Busselton Water)                                   | clearance: pdf/image — staff      |

#### WAPC

| #    | Key     | Title                                | Default resp. | Tags                     | Panels (in order) | Upload slots (key: accepts — who) |
| ---- | ------- | ------------------------------------ | ------------- | ------------------------ | ----------------- | --------------------------------- |
| 10.0 | `i12_0` | All other agency clearances obtained | KR            | —                        | status only       | —                                 |
| 10.1 | `i12_1` | Submit Form 1C (WAPC clearance)      | KR            | —                        | status only       | —                                 |
| 10.2 | `i12_2` | Form 1C Payment                      | KR            | $ Form 1C fees (KR pays) | status only       | —                                 |
| 10.3 | `i12_3` | Plan endorsed and sent to Landgate   | KR            | —                        | status only       | —                                 |

#### Survey

| #    | Key         | Title                                   | Default resp. | Tags                              | Panels (in order)                      | Upload slots (key: accepts — who) |
| ---- | ----------- | --------------------------------------- | ------------- | --------------------------------- | -------------------------------------- | --------------------------------- |
| 11.0 | `i11_0`     | Surround Survey & Western Power set-out | KR            | —                                 | photos("Western Power set-out photos") | photos: image — staff             |
| 11.1 | `i11_draft` | Draft Strata/Deposited Plan             | KR            | —                                 | documents("Draft Strata Plan")         | documents: pdf — staff            |
| 11.2 | `i11_1`     | Final Boundary Establishment            | KR            | —                                 | status only                            | —                                 |
| 11.3 | `i11_2`     | Unit Entitlement                        | KR            | $ Unit entitlement cost (KR pays) | documents("Unit Entitlement")          | documents: pdf — staff            |
| 11.4 | `i11_3`     | Finalise Plan and Field Book            | KR            | —                                 | status only                            | —                                 |

#### Landgate

| #    | Key         | Title                         | Default resp. | Tags                          | Panels (in order)                        | Upload slots (key: accepts — who)       |
| ---- | ----------- | ----------------------------- | ------------- | ----------------------------- | ---------------------------------------- | --------------------------------------- |
| 12.0 | `i13_0`     | Plan lodged at Landgate       | KR            | $ Lodgement fees (KR pays)    | documents("Final Strata Plan")           | documents: pdf — staff                  |
| 12.1 | `i13_1`     | Field book lodged at Landgate | KR            | —                             | documents("Field Book")                  | documents: pdf — staff                  |
| 12.2 | `i13_notif` | Notification and Documents    | KR            | —                             | documents("Notifications and documents") | documents: pdf/image/video/text — staff |
| 12.3 | `i13_2`     | Plan in order for dealings    | KR            | ITEM: Item 4 payment required | status only                              | —                                       |

#### Titles

| #    | Key     | Title            | Default resp. | Tags | Panels (in order)                                                    | Upload slots (key: accepts — who) |
| ---- | ------- | ---------------- | ------------- | ---- | -------------------------------------------------------------------- | --------------------------------- |
| 13.0 | `i14_0` | Settlement Agent | Client        | —    | paid("TITLES OBTAINED" → "Titles obtained"; label "Client response") | —                                 |

## 8. Computed rules (implemented once in `packages/workflow/src/rules.ts` and `dates.ts`)

| Rule                      | Definition                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1 Agency exclusion       | An optional agency stage (WP, Water Corp, Local Gov, Busselton Water) is _excluded_ when the job has ≥ 1 current condition and none names that agency. Before extraction nothing is excluded. WAPC is never excluded.                                                                                                                                                                                                                                                        |
| R2 Effective status       | Excluded stage → Not required; else stored status (default Not completed).                                                                                                                                                                                                                                                                                                                                                                                                   |
| R3 Default responsibility | New jobs seed each checkpoint's responsibility from the definition.                                                                                                                                                                                                                                                                                                                                                                                                          |
| R4 Progress               | completed / not required / not completed counts over 46; percent = round((completed + not required) / 46 × 100).                                                                                                                                                                                                                                                                                                                                                             |
| R5 Stage summary          | state = not_completed if any open, else completed if any completed, else not_required; percent over the stage.                                                                                                                                                                                                                                                                                                                                                               |
| R6 Job complete           | Effective status of 12.3 (`i13_2`) = Completed. Drives "Complete" filter, picker grouping, dashboard "All done".                                                                                                                                                                                                                                                                                                                                                             |
| R7 Next actions           | Phase 1 (Preliminaries, WAPC Approval): first open checkpoint of the first stage with one. Else phase 2: first open checkpoint in **each** non-excluded agency stage (parallel). Else phase 3 (WAPC, Survey, Landgate, Titles): first open checkpoint of the first stage with one.                                                                                                                                                                                           |
| R8 Alerts                 | (a) approval expiry passed → bad "WAPC approval expired <date>"; < 180 days → warn "WAPC approval expires in N days (<date>)". (b) outcome date set and 5.0 open: passed → bad "WAPC outcome date passed <date> – no approval recorded"; ≤ 14 days → warn "WAPC outcome due in N days". (c) any approval checkpoint with decision declined and status open → bad "Client declined the <noun> (<n>)". (d) guessed agencies → warn "N condition(s) need their agency checked". |
| R9 Waiting on client      | Job not complete and any next action has responsibility Client.                                                                                                                                                                                                                                                                                                                                                                                                              |
| R10 Outcome date          | Conformed date + 90 days, set automatically when the conformed date is set (by reading or by hand); can be overridden; "reset to 90 days".                                                                                                                                                                                                                                                                                                                                   |
| R11 Days remaining        | Whole days to 23:59:59 Australia/Perth (UTC+8, no DST) of the date, rounded up; negative after the day. **Change**: the prototype showed "0 days" for the whole day after expiry; now it reports "Expired 1 day ago".                                                                                                                                                                                                                                                        |
| R12 Countdown             | Days/hours/minutes/seconds to end of the outcome date; state soon < 14 days, past after.                                                                                                                                                                                                                                                                                                                                                                                     |
| R13 Paid                  | Pressing the client response button sets paid time and status Completed; Undo clears both (status → Not completed).                                                                                                                                                                                                                                                                                                                                                          |
| R14 Decline comment       | A declined decision requires a non-blank comment (UI, API schema and DB constraint).                                                                                                                                                                                                                                                                                                                                                                                         |
| R15 Job number            | Unique among non-archived jobs, case-insensitive; 1–32 chars of letters, digits, space, `-`, `.`, `/`.                                                                                                                                                                                                                                                                                                                                                                       |

All date maths uses an injected clock (TD-4). Dashboard alerts are computed server-side with the request time.

## 9. Administration

### 9.1 Users (`/admin/users`, admin only)

Table: name, email, role, guest/member, status, last sign-in. Search by name/email; filter by role. Actions: change role
(admin / kr_admin / staff / external), disable/enable. Guards: cannot change own role or status; cannot remove the last
active admin (409 "There must be at least one active admin."); changes revoke the target's sessions and are audited.

### 9.2 Audit trail (`/admin/audit`, admin + kr_admin)

Newest first, filter by job, user, action; columns: time, user, action, job, entity, changes (field: from → to).
Every state change is audited in the same transaction as the change (§11.3 of DATA_MODEL). Read-only, append-only.

## 10. Document processing (worker, asynchronous — ADR-0006)

All parsing of uploaded documents runs in `services/worker`, never in the browser or the API process, with page and
time limits. The UI polls `GET /v1/operations/{id}` (1 s, then backing off) and shows the result message.

### 10.1 Conformed date (4.2) — order of attempts (prototype `readConformed`)

1. **File name**: `20250728`, `2025-07-28`, `28-07-2025` (also `_` and `.` separators) → "Taken from the file name: <date>."
2. **Stamp annotation** on page 1 (digital stamp): first date in annotation text → "Read from the stamp on page 1: <date>."
3. **AI stamp reading** (only when `FEATURE_AI_STAMP_READING` is on and an Anthropic key is configured — ADR-0010):
   page 1 rendered to PNG (scale 3) and sent to Claude (`claude-sonnet-5-5`) asking for the date in the "DEPARTMENT OF
   PLANNING, LANDS AND HERITAGE" stamp box (`DATE 28-Jul-2025 FILE 878-25`), structured JSON output
   `{date, stampText, found}` → "Read from the stamp on page 1 ("DATE 28-Jul-2025 FILE 878-25"): <date>. Please check it below."
4. **Text**: a date on (or within 2 lines after) a line containing "conform" → "No stamp could be read, so the "conformed" date in the text was used: <date>. Please check it below."
5. Nothing → "No stamped date could be found on page 1 of <file>. Enter the conformed date below."; unreadable PDF →
   "<file> couldn't be read. Enter the conformed date below."
   On success the job's conformed date, method (`file_name`/`stamp_annotation`/`stamp_image`/`text`), source file and
   outcome date (+90) are set (overwriting earlier values, as in the prototype; audited).
   Date parsing (`datesIn`): Australian d/m/y with `/ . -` separators (2- or 4-digit year), "28 July 2025", "28th Jul,
   2025", "July 28, 2025"; invalid calendar dates are ignored.

### 10.2 Decision Letter extraction (5.0) — prototype `parseConditions` + `findApprovalDates`

- Only from a clean PDF in the 5.0 slot whose file name contains "decision" (case-insensitive).
- Text lines from all pages (max `PDF_MAX_PAGES`). Start after the first line matching `^conditions?\b` (< 60 chars);
  stop at the first later line matching `^advice\b`. Skip page footers ("Page 3 of 5", numbers and the
  "OFFICIAL"/"UNOFFICIAL: Sensitive" marking). A line `^(\d{1,2})[.)]\s*` starts condition n only if n = previous + 1;
  other lines append to the current condition. Clean embedded footer remnants and whitespace.
- Agency: the **last** bracketed group naming an agency ("(Western Power)", "(City of Stirling)" → Local Government,
  "(Western Australian Planning Commission)" → WAPC); otherwise guessed from keywords (electric/power → Western Power;
  busselton water; sewer/wastewater/water corporation → Water Corporation; water supply/potable → Busselton Water if
  "busselton" else Water Corporation; crossover/drainage/verge/kerb/road/footpath/local government/council/shire →
  Local Government; else WAPC) with `agencyGuessed = true`.
- Approval date: first date in the first 40 lines. Expiry: "close of business on <date>", "no longer be valid … <date>",
  "expires/expiry … <date>"; else approval date + "valid for (two|2) years".
- No conditions → message "No numbered conditions were found in this PDF. Check it is the WAPC conditional approval
  letter (not a scanned image)." (approval/expiry still saved if found). Guessed → "Check the agency for conditions 3, 7
  – no agency was named in brackets, so it was guessed."
- Replacing: previous conditions are superseded (soft) together with their evidence links; ticks/comments are not
  carried over (prototype behaviour — confirmed by the confirm dialog). Audited.

### 10.3 Email parsing (4.3)

`.msg` (Outlook CFB: subject, sender name/email, To, Cc, delivery/submit time, plain body or HTML body → text) and
`.eml` (MIME: RFC 2047 encoded words, multipart preference for text/plain, base64 / quoted-printable, charset) — port of
the prototype parser to pure functions with fuzz-style tests. HTML → text via `html-to-text` (no DOM). The viewer shows
the prototype's text rendering (Subject/From/To/Cc/Date, a rule, body).

## 11. Files

- Accepted kinds (by **content sniffing**, not extension): PDF, images (PNG, JPEG, GIF, WebP), video (MP4, WebM), text
  (TXT, CSV, MD — UTF-8, no NUL bytes), DWG (AutoCAD `AC10xx` magic), email (.msg CFB parsed successfully, .eml RFC 822
  text). Each slot narrows the set (§7). Max size `UPLOAD_MAX_BYTES` (default 50 MB). Names are sanitised (no path
  separators/control characters, ≤ 255 chars).
- Storage: private S3-compatible bucket (Railway Bucket), key `jobs/<jobId>/<fileId>`; never public, never in the web
  root. Downloads stream through the API after an authorisation check (ADR-0007).
- Malware scanning: every upload is scanned by ClamAV in the worker (`scan_status` pending → clean/infected/error).
  Content is served only when clean (or `skipped` when scanning is disabled locally). Infected objects are deleted and
  the uploader sees "Blocked – failed the virus scan"; staff are alerted via logs/metrics.
- Content responses: `Content-Disposition: inline` only for PDF/image/video/text (as `text/plain; charset=utf-8`),
  otherwise `attachment`; `X-Content-Type-Options: nosniff`; `Content-Security-Policy: default-src 'none'; img-src
'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox` for non-PDF; `Cache-Control: private, no-store`;
  HTTP Range for video.
- Removal is a soft delete (audited); a daily sweep purges objects 30 days after deletion. Archiving a job keeps files.

### 11.1 Document viewer

Modal `<dialog>` (focus trapped, Esc closes, returns focus): header with ‹ / › (when several), file name, "1 of 2",
"Open in new tab", Close. Body by kind: PDF → in-app pdf.js renderer (all pages, scrollable; works on iOS) — **Change**
from the prototype's `<iframe>`; image → `<img>`; video → `<video controls>`; text/email → `<pre>` with the text;
DWG → "DWG drawings can't be previewed in the browser" / "Download it and open it in your CAD software." + **DOWNLOAD
<name>** (direct .dwg download — **Change**: no zip wrapper). Pending scan → "This file is still being checked for
viruses."; infected → blocked message.

## 12. Look and feel, accessibility, responsive, print

- Visual design: exactly the prototype's CSS (tokens in `docs/spec/DESIGN_TOKENS.md`), Yantramanav (via `next/font`,
  self-hosted at build), noise texture background, rotated KR mark watermark, 3 px radii, 1180 px max width.
- Dark mode: follows the OS by default; the header theme control sets `data-theme="light"|"dark"` on `<html>` (stored
  in localStorage `kr-theme`, applied before first paint with a nonce'd inline script to avoid a flash).
- Responsive: breakpoints 760 px (summary and cards stack, controls below content, indents removed), 640 px (condition
  comment fields stack), 520 px (stage bar track/count hidden, outcome dates stack). 390 px wide phone screenshots are the
  reference. No horizontal scroll.
- Accessibility WCAG 2.2 AA (not overridable): semantic buttons/links, labels on all inputs (the prototype's
  `aria-label`s are kept), visible focus (2 px accent outline), `aria-pressed` on toggles, `aria-expanded` on stage
  bars, live region for save/upload status, colour is never the only signal (status label text on every card), target
  size ≥ 24 px, reduced-motion respected, axe zero serious/critical per page.
- Print / Save as PDF: print stylesheet hides buttons, drop zones and the access manager (`.no-pdf`), expands all
  stages, avoids breaking inside cards, A4 portrait.
- Language: Australian English, dates `28 Sep 2026` / `Sun, 26 Oct 2025`, Perth time.

## 13. Requirements from the prototype's developer notes

| #   | Note                                                                                                                                                                                                    | Disposition                                                                                                                                                                                                                                                                                                      |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | "Access Manager only shows up for KR email sign ins. Lets KR employees add clients, so that they can view and interact with their job."                                                                 | **In scope** — access manager for staff roles only; grants + guest sign-in (§3.4, §6).                                                                                                                                                                                                                           |
| 2   | "KR Admin (Alex, Ivan, Accounts) and clients will be able to view and download the fee proposal section of the page but, general KR employees wont."                                                    | **In scope** — `kr_admin` role and `fee_proposal.view` (§2.1).                                                                                                                                                                                                                                                   |
| 3   | "Build this into the KR website, as discussed."                                                                                                                                                         | **Future** — the app is served on its own subdomain (e.g. `tracker.krsurveys.com.au`) linked from the website. Embedding in an iframe would need `frame-ancestors` relaxation and third-party-cookie workarounds; recommend a link/button. ADR-0012.                                                             |
| 4   | "This will link back to a sharepoint folder structure (the teams channel). All documents uploaded through this portal will automatically find their way to the relevant location in the teams channel." | **Future (phase 2)** — Microsoft Graph sync worker writing to the job's Teams/SharePoint folder using the zip folder layout (§5.8). Needs Sites.Selected consent, mapping job → channel. Designed for: storage keys and folder layout are deterministic; operations queue can carry `sharepoint.sync`. ADR-0012. |
| 5   | "Create web hook to monitor e planning.com to see if there are any updates."                                                                                                                            | **Future** — WAPC ePlanning offers no public webhook; would need scraping or an official API. Out of scope; noted. ADR-0012.                                                                                                                                                                                     |

## 14. Non-functional requirements

| Area          | Requirement                                                                                                                                                                                                                                                                                                                                     |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Availability  | 99.5 % monthly for web+API (business hours focus); SLOs in `docs/slo.md`.                                                                                                                                                                                                                                                                       |
| Performance   | API p95 < 300 ms, p99 < 800 ms for reads (k6 smoke); LCP ≤ 2.5 s, INP ≤ 200 ms, CLS ≤ 0.1; first-load JS ≤ 170 KB gzip per route (pdf.js loaded lazily in the viewer only).                                                                                                                                                                     |
| Scale         | Designed for ≤ 2,000 active jobs, ≤ 200 users, ≤ 50 concurrent; job list summaries computed in the API (revisit above that).                                                                                                                                                                                                                    |
| Security      | ASVS 5.0 L2 baseline, L3 for authentication; OWASP Top 10 2025; see ADRs 0002, 0003, 0007, 0011 and `docs/security-checklist.md`. Rate limits: sign-in 20/min/IP, writes 120/min/user, uploads 30/min/user, reads 600/min/user (429 with Retry-After). Body limit 100 KB JSON.                                                                  |
| Privacy       | Personal data: names, emails of users and grantees, client names/addresses on jobs, document contents. Stored in Railway (region chosen by KR — prefer Asia-Pacific/Singapore; Australian Privacy Principles). No personal data in logs/telemetry. Retention: files purged 30 days after deletion; sessions 7 days after expiry; audit 7 years. |
| Concurrency   | Optimistic concurrency with `If-Match` versions on job, checkpoint and condition edits; 412 → reload + banner. Data refreshes every 15 s while the tab is visible and on focus.                                                                                                                                                                 |
| Browsers      | Last 2 versions of Edge, Chrome, Safari (incl. iOS), Firefox.                                                                                                                                                                                                                                                                                   |
| Observability | JSON logs (no PII), OpenTelemetry traces/metrics, request ids end to end, health checks, alerts with runbooks (ADR-0009).                                                                                                                                                                                                                       |

## 15. Edge cases

- Two staff edit the same checkpoint → the second save gets 412 and the UI reloads the checkpoint.
- Typing in a comment while data refreshes → field content is never replaced while focused (prototype rule).
- Conditions re-extracted while someone edits a condition → their PATCH returns 404/412 and the checklist reloads.
- Upload of a renamed executable as `.pdf` → rejected (415, sniffed type mismatch).
- Upload while the job is archived → 404.
- Grant to an email that already has an active grant on the job → 409; revoked grants can be re-granted.
- Guest whose email changes in their home tenant → existing active grants keep working (bound to user id).
- First sign-in of two KR staff at the same instant → exactly one admin (§3.3).
- Clock: all "days left" use Perth time regardless of server or browser time zone.
- Conformed date entered by hand after a reading → method "manual"; outcome reset to +90.
- Excluded agency stage that already had completed checkpoints → shown as Not required; stored values are kept and
  reappear if a later extraction adds conditions for that agency.
- Deleting the Decision Letter file does not delete extracted conditions.
- AI stamp reading disabled, refused, timed out or unparseable → falls through to the text rule; never blocks.
- Very large PDFs → page cap and 60 s timeout; operation fails with a clear message.

## 16. Out of scope / future work

SharePoint/Teams sync, ePlanning watcher, website embed (§13); email/Teams notifications to clients when an action
is theirs (recommended phase 2 — the "Waiting on client" data already exists); import/sync from KR's project tracker
(the prototype's `source: "KR PROJECT TRACKER"` jobs) — jobs are created in the app for now; fee/invoice amounts and
payments (the app records "paid" clicks only); e-signature of the consent letter; native mobile app; multi-tenant use
by other survey firms; offline mode.

## 17. What the prototype did not cover (added for enterprise readiness)

Job creation and archiving; real SSO, sessions, CSRF; user management and role changes; audit trail; per-role
permissions instead of one "can edit" flag; server-side document parsing, malware scanning, type sniffing and size
limits; optimistic concurrency; deep links; theme control; print stylesheet instead of canvas screenshots; Graph guest
invitations (flag); retention and purge; backups (Railway Postgres backups + bucket versioning — runbook);
observability, SLOs and runbooks; rate limiting.

## 18. Open questions for KR Surveys

1. Exact staff email domain(s) and whether any tenant members should _not_ be staff (e.g. shared mailboxes).
2. Should architects record decisions or press "works complete" (currently no)? Should clients upload into other slots?
3. Should a client decision automatically set the checkpoint status (currently manual, as in the prototype)?
4. Enable Entra B2B invitations from the app (needs `User.Invite.All` admin consent) or keep inviting in Entra?
5. Approve sending page 1 of Conformance Notifications to Anthropic for stamp reading (data leaves Australia; default off).
6. Railway region, custom domain (`tracker.krsurveys.com.au`?) and who holds Railway/GitHub admin.
7. External observability backend (Grafana Cloud / Honeycomb / Better Stack) — new external host needs approval (X7).
8. Retention periods for files of completed jobs.
