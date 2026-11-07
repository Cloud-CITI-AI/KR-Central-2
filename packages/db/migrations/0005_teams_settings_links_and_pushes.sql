-- WP-25 (ADR-0015, amended 2026-11-06): the Teams/SharePoint integration's tables.
--
-- teams_settings    one row, edited at /admin/teams: which team the app works in, the Fee Proposals channel, the switches.
-- job_teams_links   one Teams channel per job, keyed by (team_id, channel_id) so a job linked in a test team keeps that
--                   link when the settings point at the live team.
-- teams_folders     drive item ids of the layout folders the app created in a channel's root folder.
-- teams_file_pushes one row per file the app copies (or deliberately does not copy) to Teams.
--
-- Expand step (BE-8): new tables and new CHECK values only. The operations type CHECK is replaced in two steps
-- (ADD ... NOT VALID, then VALIDATE) so existing rows are not re-scanned under the lock. operations.job_id becomes
-- nullable: `teams.check` (the settings page's Test connection) belongs to no job. Old readers that assume a job see
-- only the rows they query by job, and the API answers a null job_id with the settings capability instead.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15s';

CREATE TABLE teams_settings (
  singleton                 boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  team_id                   uuid,
  team_site_url             text CHECK (team_site_url IS NULL OR (team_site_url ~ '^https://[^/]+/' AND length(team_site_url) <= 500)),
  team_name                 text CHECK (team_name IS NULL OR length(team_name) <= 200),
  fee_channel_id            text CHECK (fee_channel_id IS NULL OR fee_channel_id ~ '^19:[^/]+@thread\.(tacv2|skype)$'),
  fee_site_url              text CHECK (fee_site_url IS NULL OR (fee_site_url ~ '^https://[^/]+/' AND length(fee_site_url) <= 500)),
  root_folder               text NOT NULL DEFAULT '102. Subdivision Tracker' CHECK (length(root_folder) BETWEEN 1 AND 100),
  fee_proposal_policy       text NOT NULL DEFAULT 'exclude' CHECK (fee_proposal_policy IN ('exclude', 'restricted')),
  sync_enabled              boolean NOT NULL DEFAULT false,
  inbound_sync_enabled      boolean NOT NULL DEFAULT false,
  create_channels_enabled   boolean NOT NULL DEFAULT false,
  inbound_poll_seconds      integer NOT NULL DEFAULT 300 CHECK (inbound_poll_seconds >= 60),
  updated_by                uuid REFERENCES users (id),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  version                   integer NOT NULL DEFAULT 1 CHECK (version > 0),
  -- each lower switch needs the one above it (PRODUCT_SPEC §9.3)
  CONSTRAINT teams_settings_switch_order CHECK (
    (NOT inbound_sync_enabled OR sync_enabled) AND (NOT create_channels_enabled OR inbound_sync_enabled)
  ),
  -- copying needs a team to copy into
  CONSTRAINT teams_settings_sync_needs_team CHECK (NOT sync_enabled OR (team_id IS NOT NULL AND team_site_url IS NOT NULL)),
  -- routing fee proposals needs the private channel
  CONSTRAINT teams_settings_restricted_needs_fee_channel CHECK (
    fee_proposal_policy <> 'restricted' OR (fee_channel_id IS NOT NULL AND fee_site_url IS NOT NULL)
  )
);
INSERT INTO teams_settings (singleton) VALUES (true);

CREATE TABLE job_teams_links (
  job_id                  uuid PRIMARY KEY REFERENCES jobs (id) ON DELETE CASCADE,
  team_id                 uuid NOT NULL,
  channel_id              text NOT NULL CHECK (channel_id ~ '^19:[^/]+@thread\.(tacv2|skype)$'),
  channel_name            text NOT NULL CHECK (length(channel_name) BETWEEN 1 AND 50),
  status                  text NOT NULL DEFAULT 'provisioning' CHECK (status IN ('provisioning', 'ready', 'error')),
  drive_id                text CHECK (drive_id IS NULL OR length(drive_id) <= 200),
  channel_folder_item_id  text CHECK (channel_folder_item_id IS NULL OR length(channel_folder_item_id) <= 200),
  root_folder_item_id     text CHECK (root_folder_item_id IS NULL OR length(root_folder_item_id) <= 200),
  sharepoint_url          text CHECK (sharepoint_url IS NULL OR length(sharepoint_url) <= 1000),
  teams_url               text NOT NULL CHECK (teams_url ~ '^https://teams\.microsoft\.com/' AND length(teams_url) <= 1000),
  error_code              text CHECK (error_code IS NULL OR length(error_code) <= 80),
  linked_by               uuid REFERENCES users (id),
  linked_at               timestamptz NOT NULL DEFAULT now(),
  provisioned_at          timestamptz,
  last_push_at            timestamptz,
  version                 integer NOT NULL DEFAULT 1 CHECK (version > 0),
  CONSTRAINT job_teams_links_channel_unique UNIQUE (team_id, channel_id)
);

CREATE TABLE teams_folders (
  job_id         uuid NOT NULL REFERENCES job_teams_links (job_id) ON DELETE CASCADE,
  folder_path    text NOT NULL CHECK (length(folder_path) BETWEEN 1 AND 400),
  drive_item_id  text NOT NULL CHECK (length(drive_item_id) <= 200),
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (job_id, folder_path)
);

CREATE TABLE teams_file_pushes (
  file_id        uuid PRIMARY KEY REFERENCES files (id) ON DELETE CASCADE,
  job_id         uuid NOT NULL REFERENCES jobs (id) ON DELETE CASCADE,
  status         text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'uploading', 'pushed', 'excluded', 'failed')),
  remote_name    text CHECK (remote_name IS NULL OR length(remote_name) <= 255),
  remote_path    text CHECK (remote_path IS NULL OR length(remote_path) <= 800),
  drive_item_id  text CHECK (drive_item_id IS NULL OR length(drive_item_id) <= 200),
  etag           text CHECK (etag IS NULL OR length(etag) <= 200),
  size_bytes     bigint CHECK (size_bytes IS NULL OR size_bytes >= 0),
  attempts       integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  error_code     text CHECK (error_code IS NULL OR length(error_code) <= 80),
  pushed_at      timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX teams_file_pushes_due_idx ON teams_file_pushes (job_id) WHERE status IN ('pending', 'failed');

-- The settings row is never deleted; the rest follow the default privileges (DML for tracker_app).
REVOKE DELETE, TRUNCATE ON teams_settings FROM tracker_app;

-- Operation types for this work package. The original CHECK has no name of its own, so Postgres named it
-- operations_type_check. The replacement is added NOT VALID (as 0003 did): it holds for every new and updated row at
-- once without scanning the table under the lock; every existing row satisfies it anyway, and a later contract step
-- may VALIDATE it in its own transaction.
ALTER TABLE operations DROP CONSTRAINT operations_type_check;
ALTER TABLE operations ADD CONSTRAINT operations_type_check CHECK (
  type IN ('conditions.extract', 'conformance.read', 'email.parse', 'file.scan', 'teams.provision', 'teams.push', 'teams.check')
) NOT VALID;

-- `teams.check` belongs to no job. Existing clients never read job_id without first selecting by a job, and the API's
-- getOperation answers a null job_id with the settings capability (services/api operations module), so nothing breaks.
-- squawk-ignore ban-drop-not-null
ALTER TABLE operations ALTER COLUMN job_id DROP NOT NULL;
