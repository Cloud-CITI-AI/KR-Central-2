-- 0001_initial_schema.sql — KR Subdivision Tracker initial schema (see docs/spec/DATA_MODEL.md).
-- Runs as tracker_migrator with search_path=tracker. The runner sets lock_timeout=5s and statement_timeout.
-- All tables are new, so plain CREATE INDEX is safe here; later migrations on populated tables must use
-- CREATE INDEX CONCURRENTLY in a "-- migrate:no-transaction" file (DB-3).

SET lock_timeout = '5s';
SET statement_timeout = '60s';

-- ---------------------------------------------------------------------------------------------- helpers
CREATE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------------------------- identity
CREATE TABLE users (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entra_tenant_id  uuid NOT NULL,
  entra_object_id  uuid NOT NULL,
  email            citext CHECK (email IS NULL OR length(email) <= 254),
  display_name     text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 200),
  role             text NOT NULL DEFAULT 'external' CHECK (role IN ('admin', 'kr_admin', 'staff', 'external')),
  is_guest         boolean NOT NULL,
  status           text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  last_sign_in_at  timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  version          integer NOT NULL DEFAULT 1 CHECK (version > 0),
  CONSTRAINT users_entra_identity_key UNIQUE (entra_tenant_id, entra_object_id)
);
CREATE INDEX users_email_idx ON users (email);
CREATE INDEX users_role_idx ON users (role) WHERE status = 'active';
CREATE TRIGGER users_set_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Exactly one row ever: the first eligible user to sign in. The PK on a constant makes the race safe:
-- concurrent first sign-ins both INSERT ... ON CONFLICT DO NOTHING and only one gets a row back (ADR-0003).
CREATE TABLE system_bootstrap (
  singleton            boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  first_admin_user_id  uuid NOT NULL UNIQUE REFERENCES users (id),
  created_at           timestamptz NOT NULL DEFAULT now()
);

-- Server-side sessions (ADR-0002). Only the SHA-256 of the session id is stored.
CREATE TABLE sessions (
  id_hash              bytea PRIMARY KEY CHECK (length(id_hash) = 32),
  user_id              uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  csrf_token           text NOT NULL CHECK (length(csrf_token) BETWEEN 32 AND 128),
  auth_time            timestamptz NOT NULL,
  amr                  text[] NOT NULL DEFAULT '{}',
  acrs                 text[] NOT NULL DEFAULT '{}',   -- Conditional Access authentication contexts (MFA evidence option)
  user_agent           text CHECK (user_agent IS NULL OR length(user_agent) <= 256),
  created_at           timestamptz NOT NULL DEFAULT now(),
  last_seen_at         timestamptz NOT NULL DEFAULT now(),
  idle_expires_at      timestamptz NOT NULL,
  absolute_expires_at  timestamptz NOT NULL,
  revoked_at           timestamptz,
  revoked_reason       text CHECK (revoked_reason IS NULL OR revoked_reason IN ('logout', 'role_changed', 'user_disabled', 'rotated', 'admin'))
);
CREATE INDEX sessions_user_id_idx ON sessions (user_id) WHERE revoked_at IS NULL;
CREATE INDEX sessions_absolute_expiry_idx ON sessions (absolute_expires_at);

-- Pending OIDC authorization requests (state → nonce + PKCE verifier), 10-minute TTL.
CREATE TABLE auth_flows (
  state_hash     bytea PRIMARY KEY CHECK (length(state_hash) = 32),
  nonce          text NOT NULL,
  code_verifier  text NOT NULL,
  return_to      text NOT NULL CHECK (return_to LIKE '/%' AND return_to NOT LIKE '//%' AND length(return_to) <= 512),
  -- SHA-256 of the random value in the __Host-kr_auth cookie set by startLogin: completeLogin requires the same
  -- browser (login-CSRF / session-swap protection, ADR-0002).
  browser_binding_hash bytea NOT NULL CHECK (length(browser_binding_hash) = 32),
  created_at     timestamptz NOT NULL DEFAULT now(),
  expires_at     timestamptz NOT NULL
);
CREATE INDEX auth_flows_expiry_idx ON auth_flows (expires_at);

-- ---------------------------------------------------------------------------------------------- workflow reference data
-- Mirrors packages/workflow CHECKPOINTS (a test asserts they are identical). Read-only for the app role.
CREATE TABLE checkpoint_definitions (
  key                     text PRIMARY KEY CHECK (key ~ '^i[0-9a-z_]+$'),
  display_number          text NOT NULL UNIQUE,
  stage_key               text NOT NULL CHECK (stage_key IN ('preliminaries', 'wapc-approval', 'western-power', 'water-corporation',
                                                             'local-government', 'busselton-water', 'wapc', 'survey', 'landgate', 'titles')),
  sort_order              smallint NOT NULL UNIQUE,
  title                   text NOT NULL,
  default_responsibility  text CHECK (default_responsibility IN ('kr', 'client', 'architect')),
  restricted              text CHECK (restricted IN ('fee_proposal'))
);

INSERT INTO checkpoint_definitions (key, display_number, stage_key, sort_order, title, default_responsibility, restricted) VALUES
  ('i1_0p', '1.0', 'preliminaries', 1, 'Fee proposal', 'client', 'fee_proposal'),
  ('i2_0', '2.0', 'preliminaries', 2, 'Site Feature Survey', 'kr', NULL),
  ('i3_0p', '3.0', 'wapc-approval', 3, 'WAPC Proposal', 'client', NULL),
  ('i4_0', '4.0', 'wapc-approval', 4, 'WAPC Form 1A application lodged', 'kr', NULL),
  ('i4_1', '4.1', 'wapc-approval', 5, 'WAPC Application Payment', 'client', NULL),
  ('i4_2', '4.2', 'wapc-approval', 6, 'WAPC Application Conformed', 'kr', NULL),
  ('i4_3', '4.3', 'wapc-approval', 7, 'Queries from WAPC', 'kr', NULL),
  ('i5_0', '5.0', 'wapc-approval', 8, 'WAPC conditional approval received', 'kr', NULL),
  ('i6_0', '6.0', 'western-power', 9, 'Western Power connection application', 'kr', NULL),
  ('i6_1a', '6.1', 'western-power', 10, 'Western Power Quote', 'client', NULL),
  ('i6_1', '6.2', 'western-power', 11, 'Quote acceptance with Western Power', 'kr', NULL),
  ('i6_2', '6.3', 'western-power', 12, 'Western Power Invoice Payment', 'client', NULL),
  ('i6_4', '6.4', 'western-power', 13, 'Western Power Contractor', 'kr', NULL),
  ('i6_6', '6.5', 'western-power', 14, 'Western Power site work complete', 'client', NULL),
  ('i6_7', '6.6', 'western-power', 15, 'Internal electrical work complete', 'client', NULL),
  ('i6_8', '6.7', 'western-power', 16, 'Submit for clearance', 'kr', NULL),
  ('i6_9', '6.8', 'western-power', 17, 'Western Power clearance received', 'kr', NULL),
  ('i7_0', '7.0', 'water-corporation', 18, 'Water Corporation agreement request', 'kr', NULL),
  ('i7_1', '7.1', 'water-corporation', 19, 'Water Corporation agreement received', 'kr', NULL),
  ('i7_2', '7.2', 'water-corporation', 20, 'Sewer junction cut-in', 'client', NULL),
  ('i7_3', '7.3', 'water-corporation', 21, 'Sewer junction cut-in complete', 'client', NULL),
  ('i7_4', '7.4', 'water-corporation', 22, 'Submit for clearance', 'kr', NULL),
  ('i7_5', '7.5', 'water-corporation', 23, 'Water Corporation Invoice Payment', 'client', NULL),
  ('i7_6', '7.6', 'water-corporation', 24, 'Water Corporation clearance received', 'kr', NULL),
  ('i8_2', '8.0', 'local-government', 25, 'Submit for clearance', 'kr', NULL),
  ('i8_3', '8.1', 'local-government', 26, 'Additional Council Payments', 'client', NULL),
  ('i8_4', '8.2', 'local-government', 27, 'Local Government clearance received', 'kr', NULL),
  ('i9_0', '9.0', 'busselton-water', 28, 'Busselton Water – request for quotation', 'kr', NULL),
  ('i9_1', '9.1', 'busselton-water', 29, 'Quotation received', 'client', NULL),
  ('i9_2', '9.2', 'busselton-water', 30, 'Quotation paid', 'client', NULL),
  ('i9_3', '9.3', 'busselton-water', 31, 'Submit for clearance', 'kr', NULL),
  ('i9_4', '9.4', 'busselton-water', 32, 'Busselton Water clearance received', 'kr', NULL),
  ('i12_0', '10.0', 'wapc', 33, 'All other agency clearances obtained', 'kr', NULL),
  ('i12_1', '10.1', 'wapc', 34, 'Submit Form 1C (WAPC clearance)', 'kr', NULL),
  ('i12_2', '10.2', 'wapc', 35, 'Form 1C Payment', 'kr', NULL),
  ('i12_3', '10.3', 'wapc', 36, 'Plan endorsed and sent to Landgate', 'kr', NULL),
  ('i11_0', '11.0', 'survey', 37, 'Surround Survey & Western Power set-out', 'kr', NULL),
  ('i11_draft', '11.1', 'survey', 38, 'Draft Strata/Deposited Plan', 'kr', NULL),
  ('i11_1', '11.2', 'survey', 39, 'Final Boundary Establishment', 'kr', NULL),
  ('i11_2', '11.3', 'survey', 40, 'Unit Entitlement', 'kr', NULL),
  ('i11_3', '11.4', 'survey', 41, 'Finalise Plan and Field Book', 'kr', NULL),
  ('i13_0', '12.0', 'landgate', 42, 'Plan lodged at Landgate', 'kr', NULL),
  ('i13_1', '12.1', 'landgate', 43, 'Field book lodged at Landgate', 'kr', NULL),
  ('i13_notif', '12.2', 'landgate', 44, 'Notification and Documents', 'kr', NULL),
  ('i13_2', '12.3', 'landgate', 45, 'Plan in order for dealings', 'kr', NULL),
  ('i14_0', '13.0', 'titles', 46, 'Settlement Agent', 'client', NULL);

-- ---------------------------------------------------------------------------------------------- jobs
CREATE TABLE jobs (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- R15: 1–32 characters of letters, digits, space, '-', '.', '/'.
  job_number                 citext NOT NULL CHECK (job_number::text ~ '^[A-Za-z0-9 ./-]{1,32}$'),
  address                    text NOT NULL CHECK (length(address) BETWEEN 1 AND 200),
  client_name                text CHECK (client_name IS NULL OR length(client_name) BETWEEN 1 AND 200),
  subdivision_type           text CHECK (subdivision_type IN ('Survey-Strata', 'Built Strata', 'Amalgamation', 'Freehold',
                                                              'Strata Conversion', 'Re-Subdivision')),
  approval_date              date,
  approval_expiry            date,
  conformed_date             date,
  conformed_method           text CHECK (conformed_method IN ('manual', 'file_name', 'stamp_annotation', 'stamp_image', 'text')),
  conformed_file_id          uuid,
  conformed_stamp_text       text CHECK (conformed_stamp_text IS NULL OR length(conformed_stamp_text) <= 200),
  outcome_date               date,
  conditions_source_file_id  uuid,
  conditions_extracted_at    timestamptz,
  created_by                 uuid REFERENCES users (id),
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now(),
  deleted_at                 timestamptz,
  deleted_by                 uuid REFERENCES users (id),
  version                    integer NOT NULL DEFAULT 1 CHECK (version > 0),
  CONSTRAINT jobs_conformed_method_with_date CHECK ((conformed_date IS NULL) = (conformed_method IS NULL))
);
CREATE UNIQUE INDEX jobs_job_number_active_key ON jobs (job_number) WHERE deleted_at IS NULL;
CREATE INDEX jobs_active_updated_idx ON jobs (updated_at DESC) WHERE deleted_at IS NULL;
CREATE TRIGGER jobs_set_updated_at BEFORE UPDATE ON jobs FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- One row per job x checkpoint, created with the job (46 rows). Effective status (agency exclusion) is computed.
CREATE TABLE checkpoint_states (
  job_id            uuid NOT NULL REFERENCES jobs (id) ON DELETE CASCADE,
  checkpoint_key    text NOT NULL REFERENCES checkpoint_definitions (key),
  status            text NOT NULL DEFAULT 'not_completed' CHECK (status IN ('completed', 'not_completed', 'not_required')),
  responsibility    text CHECK (responsibility IN ('kr', 'client', 'architect')),
  kr_note           text NOT NULL DEFAULT '' CHECK (length(kr_note) <= 2000),
  paid_at           timestamptz,
  paid_by           uuid REFERENCES users (id),
  decision          text CHECK (decision IN ('accepted', 'declined')),
  decision_comment  text NOT NULL DEFAULT '' CHECK (length(decision_comment) <= 2000),
  decided_at        timestamptz,
  decided_by        uuid REFERENCES users (id),
  updated_by        uuid REFERENCES users (id),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  version           integer NOT NULL DEFAULT 1 CHECK (version > 0),
  PRIMARY KEY (job_id, checkpoint_key),
  CONSTRAINT checkpoint_states_decline_needs_comment CHECK (decision IS DISTINCT FROM 'declined' OR length(btrim(decision_comment)) > 0),
  CONSTRAINT checkpoint_states_decision_complete CHECK ((decision IS NULL) = (decided_at IS NULL)),
  CONSTRAINT checkpoint_states_paid_complete CHECK (paid_at IS NOT NULL OR paid_by IS NULL)
);
CREATE TRIGGER checkpoint_states_set_updated_at BEFORE UPDATE ON checkpoint_states FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- WAPC conditions extracted from the Decision Letter. Re-extraction supersedes (soft) the previous set.
CREATE TABLE conditions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id            uuid NOT NULL REFERENCES jobs (id) ON DELETE CASCADE,
  condition_number  integer NOT NULL CHECK (condition_number > 0),
  text              text NOT NULL CHECK (length(text) BETWEEN 1 AND 10000),
  agency            text NOT NULL CHECK (agency IN ('Western Power', 'Water Corporation', 'Local Government', 'Busselton Water', 'WAPC')),
  agency_guessed    boolean NOT NULL DEFAULT false,
  is_cleared        boolean NOT NULL DEFAULT false,
  cleared_at        timestamptz,
  cleared_by        uuid REFERENCES users (id),
  responsibility    text CHECK (responsibility IN ('kr', 'client')),
  kr_comment        text NOT NULL DEFAULT '' CHECK (length(kr_comment) <= 4000),
  client_comment    text NOT NULL DEFAULT '' CHECK (length(client_comment) <= 4000),
  extraction_id     uuid,
  superseded_at     timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        uuid REFERENCES users (id),
  version           integer NOT NULL DEFAULT 1 CHECK (version > 0),
  -- Target of the composite FK from files: evidence can only attach to a condition of the same job.
  CONSTRAINT conditions_job_id_id_key UNIQUE (job_id, id)
);
CREATE UNIQUE INDEX conditions_job_number_current_key ON conditions (job_id, condition_number) WHERE superseded_at IS NULL;
CREATE TRIGGER conditions_set_updated_at BEFORE UPDATE ON conditions FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------------------------- files
-- Object bytes live in S3-compatible storage under storage_key (never in the web root). Attached either to a
-- checkpoint slot or to a condition (evidence).
CREATE TABLE files (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id          uuid NOT NULL REFERENCES jobs (id) ON DELETE CASCADE,
  checkpoint_key  text,
  slot            text CHECK (slot IS NULL OR slot ~ '^[a-z_]{1,40}$'),
  condition_id    uuid,
  storage_key     text NOT NULL UNIQUE,
  original_name   text NOT NULL CHECK (length(original_name) BETWEEN 1 AND 255),
  kind            text NOT NULL CHECK (kind IN ('pdf', 'image', 'video', 'text', 'dwg', 'email')),
  content_type    text NOT NULL CHECK (length(content_type) <= 127),
  size_bytes      bigint NOT NULL CHECK (size_bytes >= 0),
  sha256          bytea NOT NULL CHECK (length(sha256) = 32),
  scan_status     text NOT NULL DEFAULT 'pending' CHECK (scan_status IN ('pending', 'clean', 'infected', 'error', 'skipped')),
  scan_detail     text CHECK (scan_detail IS NULL OR length(scan_detail) <= 500),
  scanned_at      timestamptz,
  scan_attempts   integer NOT NULL DEFAULT 0 CHECK (scan_attempts >= 0),   -- retries of 'error' scans (SCAN_ERROR_MAX_RETRIES)
  uploaded_by     uuid REFERENCES users (id),
  uploaded_at     timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz,
  deleted_by      uuid REFERENCES users (id),
  purged_at       timestamptz,
  CONSTRAINT files_target_check CHECK (
    (checkpoint_key IS NOT NULL AND slot IS NOT NULL AND condition_id IS NULL)
    OR (checkpoint_key IS NULL AND slot IS NULL AND condition_id IS NOT NULL)
  ),
  CONSTRAINT files_checkpoint_fk FOREIGN KEY (job_id, checkpoint_key) REFERENCES checkpoint_states (job_id, checkpoint_key) ON DELETE CASCADE,
  -- Same-job integrity for evidence (MATCH SIMPLE: not checked when condition_id IS NULL).
  CONSTRAINT files_condition_fk FOREIGN KEY (job_id, condition_id) REFERENCES conditions (job_id, id) ON DELETE CASCADE,
  -- Target of the composite FKs from jobs (conformed / conditions source file must belong to the same job).
  CONSTRAINT files_job_id_id_key UNIQUE (job_id, id)
);
CREATE INDEX files_job_active_idx ON files (job_id, checkpoint_key) WHERE deleted_at IS NULL;
CREATE INDEX files_condition_idx ON files (condition_id) WHERE condition_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX files_scan_pending_idx ON files (uploaded_at) WHERE scan_status = 'pending' AND deleted_at IS NULL;
CREATE INDEX files_purge_idx ON files (deleted_at) WHERE deleted_at IS NOT NULL AND purged_at IS NULL;

-- Composite FKs: the referenced file must belong to the same job (MATCH SIMPLE: unchecked while the column is NULL).
ALTER TABLE jobs ADD CONSTRAINT jobs_conformed_file_fk FOREIGN KEY (id, conformed_file_id) REFERENCES files (job_id, id);
ALTER TABLE jobs ADD CONSTRAINT jobs_conditions_source_file_fk FOREIGN KEY (id, conditions_source_file_id) REFERENCES files (job_id, id);

-- Parsed metadata for WAPC query emails (.msg / .eml / pasted text). The original stays in `files`.
CREATE TABLE email_messages (
  file_id       uuid PRIMARY KEY REFERENCES files (id) ON DELETE CASCADE,
  parse_status  text NOT NULL DEFAULT 'pending' CHECK (parse_status IN ('pending', 'parsed', 'failed')),
  subject       text CHECK (subject IS NULL OR length(subject) <= 1000),
  from_text     text CHECK (from_text IS NULL OR length(from_text) <= 1000),
  to_text       text CHECK (to_text IS NULL OR length(to_text) <= 4000),
  cc_text       text CHECK (cc_text IS NULL OR length(cc_text) <= 4000),
  sent_at       timestamptz,
  body_text     text CHECK (body_text IS NULL OR length(body_text) <= 500000),
  is_pasted     boolean NOT NULL DEFAULT false,
  parsed_at     timestamptz
);

-- ---------------------------------------------------------------------------------------------- collaboration
CREATE TABLE job_notes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id      uuid NOT NULL REFERENCES jobs (id) ON DELETE CASCADE,
  body        text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 5000),
  audience    text NOT NULL DEFAULT 'all' CHECK (audience IN ('all', 'surveyor', 'client')),
  author_id   uuid REFERENCES users (id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz,
  deleted_by  uuid REFERENCES users (id)
);
CREATE INDEX job_notes_job_created_idx ON job_notes (job_id, created_at DESC, id DESC) WHERE deleted_at IS NULL;

-- Access manager: a client/architect email granted one job. Activates (binds user_id) on first matching sign-in.
CREATE TABLE access_grants (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id             uuid NOT NULL REFERENCES jobs (id) ON DELETE CASCADE,
  email              citext NOT NULL CHECK (length(email) BETWEEN 3 AND 254),
  display_name       text CHECK (display_name IS NULL OR length(display_name) BETWEEN 1 AND 120),
  role               text NOT NULL CHECK (role IN ('client', 'architect')),
  status             text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'revoked')),
  user_id            uuid REFERENCES users (id),
  invitation_status  text NOT NULL DEFAULT 'not_sent' CHECK (invitation_status IN ('not_sent', 'sent', 'failed')),
  invitation_error   text CHECK (invitation_error IS NULL OR length(invitation_error) <= 500),
  invited_by         uuid REFERENCES users (id),
  invited_at         timestamptz NOT NULL DEFAULT now(),
  activated_at       timestamptz,
  revoked_at         timestamptz,
  revoked_by         uuid REFERENCES users (id),
  CONSTRAINT access_grants_active_has_user CHECK (status <> 'active' OR (user_id IS NOT NULL AND activated_at IS NOT NULL)),
  CONSTRAINT access_grants_revoked_has_time CHECK (status <> 'revoked' OR revoked_at IS NOT NULL)
);
CREATE UNIQUE INDEX access_grants_job_email_open_key ON access_grants (job_id, email) WHERE status <> 'revoked';
CREATE INDEX access_grants_email_pending_idx ON access_grants (email) WHERE status = 'pending';
CREATE INDEX access_grants_user_active_idx ON access_grants (user_id, job_id) WHERE status = 'active';

-- ---------------------------------------------------------------------------------------------- async work
-- User-visible operations double as the worker queue (SELECT ... FOR UPDATE SKIP LOCKED). ADR-0006.
CREATE TABLE operations (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id         uuid NOT NULL REFERENCES jobs (id) ON DELETE CASCADE,
  type           text NOT NULL CHECK (type IN ('conditions.extract', 'conformance.read', 'email.parse', 'file.scan')),
  status         text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'succeeded', 'failed')),
  payload        jsonb NOT NULL DEFAULT '{}'::jsonb,
  result         jsonb,
  error_code     text CHECK (error_code IS NULL OR length(error_code) <= 80),
  error_message  text CHECK (error_message IS NULL OR length(error_message) <= 1000),
  attempts       integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts   integer NOT NULL DEFAULT 3 CHECK (max_attempts > 0),
  run_after      timestamptz NOT NULL DEFAULT now(),
  locked_by      text,
  locked_until   timestamptz,
  created_by     uuid REFERENCES users (id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  started_at     timestamptz,
  completed_at   timestamptz
);
CREATE INDEX operations_queue_idx ON operations (run_after, created_at) WHERE status = 'queued';
CREATE INDEX operations_running_lease_idx ON operations (locked_until) WHERE status = 'running';
CREATE INDEX operations_job_idx ON operations (job_id, created_at DESC);

-- Idempotency keys for side-effecting POSTs (API-5). Swept after 24 h.
CREATE TABLE idempotency_keys (
  user_id          uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  key              text NOT NULL CHECK (length(key) BETWEEN 8 AND 128),
  operation_id     text NOT NULL,
  request_hash     bytea NOT NULL,
  response_status  integer,
  response_body    jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);
CREATE INDEX idempotency_keys_created_idx ON idempotency_keys (created_at);

-- Rate limiter store (rate-limiter-flexible RateLimiterPostgres with tableCreated: true).
CREATE TABLE rate_limits (
  key     varchar(255) PRIMARY KEY,
  points  integer NOT NULL DEFAULT 0,
  expire  bigint
);

-- ---------------------------------------------------------------------------------------------- audit
-- Append-only: the app role may INSERT and SELECT only. Contains user ids and changed values; no tokens.
CREATE TABLE audit_events (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  occurred_at    timestamptz NOT NULL DEFAULT now(),
  actor_user_id  uuid REFERENCES users (id),
  actor_type     text NOT NULL CHECK (actor_type IN ('user', 'system')),
  action         text NOT NULL CHECK (action ~ '^[a-z_]+\.[a-z_.]+$'),
  job_id         uuid REFERENCES jobs (id),
  entity_type    text NOT NULL CHECK (length(entity_type) <= 40),
  entity_id      text CHECK (entity_id IS NULL OR length(entity_id) <= 100),
  request_id     text CHECK (request_id IS NULL OR length(request_id) <= 100),
  changes        jsonb,
  CONSTRAINT audit_events_actor_check CHECK ((actor_type = 'user') = (actor_user_id IS NOT NULL))
);
CREATE INDEX audit_events_job_idx ON audit_events (job_id, id DESC) WHERE job_id IS NOT NULL;
CREATE INDEX audit_events_actor_idx ON audit_events (actor_user_id, id DESC) WHERE actor_user_id IS NOT NULL;
CREATE INDEX audit_events_occurred_idx ON audit_events (occurred_at DESC);

-- ---------------------------------------------------------------------------------------------- privileges
-- Default privileges (bootstrap-roles.sql) grant DML on new tables to tracker_app; tighten the exceptions.
REVOKE UPDATE, DELETE, TRUNCATE ON audit_events FROM tracker_app;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON checkpoint_definitions FROM tracker_app;
REVOKE UPDATE, DELETE, TRUNCATE ON system_bootstrap FROM tracker_app;
