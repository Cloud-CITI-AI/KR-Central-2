-- WP-26 (ADR-0015 A4, phase 2: Teams → app) and the table WP-27 (phase 3) reads.
--
-- teams_inbound_items  every item the worker has seen in a linked job's root folder that it did not put there itself:
--                      imported into a checkpoint or condition, waiting on the Unfiled list, dismissed, failed, removed.
-- teams_channels       the worker's cache of the configured team's channels (phase 3 picker and name check).
-- files                `source` (upload | teams), `teams_removed_at` (deleted in Teams; the app keeps the file) and
--                      `deleted_reason` (`teams_replaced` when an edit in Teams superseded it).
-- job_teams_links      `last_poll_at` and the Graph delta token of the last poll.
-- teams_file_pushes    status gains deleting | deleted (app deletes propagate to Teams under phase 2).
-- operations           types teams.poll, teams.create_channel, teams.list_channels.
-- Expand step (BE-8): new tables, nullable columns, a constant default, and CHECKs replaced NOT VALID (as 0003/0005).
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15s';

CREATE TABLE teams_inbound_items (
  job_id            uuid NOT NULL REFERENCES job_teams_links (job_id) ON DELETE CASCADE,
  drive_item_id     text NOT NULL CHECK (length(drive_item_id) <= 200),
  remote_path       text NOT NULL CHECK (length(remote_path) <= 800),
  name              text NOT NULL CHECK (length(name) BETWEEN 1 AND 255),
  size_bytes        bigint CHECK (size_bytes IS NULL OR size_bytes >= 0),
  etag              text CHECK (etag IS NULL OR length(etag) <= 200),
  modified_by_name  text CHECK (modified_by_name IS NULL OR length(modified_by_name) <= 200),
  modified_at       timestamptz,
  status            text NOT NULL DEFAULT 'seen'
                    CHECK (status IN ('seen', 'importing', 'imported', 'unfiled', 'dismissed', 'failed', 'removed')),
  file_id           uuid REFERENCES files (id) ON DELETE SET NULL,
  error_code        text CHECK (error_code IS NULL OR length(error_code) <= 80),
  seen_at           timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (job_id, drive_item_id)
);
CREATE INDEX teams_inbound_items_unfiled_idx ON teams_inbound_items (job_id, seen_at) WHERE status = 'unfiled';

CREATE TABLE teams_channels (
  team_id          uuid NOT NULL,
  channel_id       text NOT NULL CHECK (channel_id ~ '^19:[^/]+@thread\.(tacv2|skype)$'),
  display_name     text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 50),
  folder_name      text CHECK (folder_name IS NULL OR length(folder_name) <= 255),
  membership_type  text NOT NULL CHECK (membership_type IN ('standard', 'private', 'shared', 'unknown')),
  seen_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (team_id, channel_id)
);

ALTER TABLE files ADD COLUMN source text NOT NULL DEFAULT 'upload';
ALTER TABLE files ADD CONSTRAINT files_source_check CHECK (source IN ('upload', 'teams')) NOT VALID;
ALTER TABLE files ADD COLUMN teams_removed_at timestamptz;
ALTER TABLE files ADD COLUMN deleted_reason text;
ALTER TABLE files ADD CONSTRAINT files_deleted_reason_check
  CHECK (deleted_reason IS NULL OR deleted_reason IN ('user', 'teams_replaced')) NOT VALID;

ALTER TABLE job_teams_links ADD COLUMN last_poll_at timestamptz;
ALTER TABLE job_teams_links ADD COLUMN delta_token text;
ALTER TABLE job_teams_links ADD CONSTRAINT job_teams_links_delta_token_len
  CHECK (delta_token IS NULL OR length(delta_token) <= 2000) NOT VALID;

ALTER TABLE teams_file_pushes DROP CONSTRAINT teams_file_pushes_status_check;
ALTER TABLE teams_file_pushes ADD CONSTRAINT teams_file_pushes_status_check CHECK (
  status IN ('pending', 'uploading', 'pushed', 'excluded', 'failed', 'deleting', 'deleted')
) NOT VALID;

ALTER TABLE operations DROP CONSTRAINT operations_type_check;
ALTER TABLE operations ADD CONSTRAINT operations_type_check CHECK (
  type IN ('conditions.extract', 'conformance.read', 'email.parse', 'file.scan',
           'teams.provision', 'teams.push', 'teams.check', 'teams.poll', 'teams.create_channel', 'teams.list_channels')
) NOT VALID;
