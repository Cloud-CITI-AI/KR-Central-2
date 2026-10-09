/**
 * Kysely table types for schema `tracker` — must mirror migrations/*.sql exactly (docs/spec/DATA_MODEL.md).
 * Conventions: `date` columns are returned as 'yyyy-mm-dd' strings (type parser in pool.ts), `timestamptz` as Date,
 * `bigint` (identity) as string, `bytea` as Buffer.
 */
import type { ColumnType, Generated, Insertable, Selectable, Updateable } from "kysely";

type Timestamp = ColumnType<Date, Date | string, Date | string>;
type GeneratedTimestamp = ColumnType<Date, Date | string | undefined, Date | string>;
type IsoDate = ColumnType<string, string, string>;
type Json = ColumnType<unknown, string, string>;

export type GlobalRoleValue = "admin" | "kr_admin" | "staff" | "external";
export type CheckpointStatusValue = "completed" | "not_completed" | "not_required";
export type ResponsibilityValue = "kr" | "client" | "architect";
export type ConformedMethodValue = "manual" | "file_name" | "stamp_annotation" | "stamp_image" | "text";
export type FileKindValue = "pdf" | "image" | "video" | "text" | "dwg" | "email";
export type ScanStatusValue = "pending" | "clean" | "infected" | "error" | "skipped";
export type OperationTypeValue = "conditions.extract" | "conformance.read" | "email.parse" | "file.scan";
export type OperationStatusValue = "queued" | "running" | "succeeded" | "failed";

export interface UsersTable {
  id: Generated<string>;
  entra_tenant_id: string;
  entra_object_id: string;
  email: string | null;
  display_name: string;
  role: ColumnType<GlobalRoleValue, GlobalRoleValue | undefined, GlobalRoleValue>;
  is_guest: boolean;
  status: ColumnType<"active" | "disabled", "active" | "disabled" | undefined, "active" | "disabled">;
  last_sign_in_at: Timestamp | null;
  created_at: GeneratedTimestamp;
  updated_at: GeneratedTimestamp;
  version: Generated<number>;
}

export interface SystemBootstrapTable {
  singleton: Generated<boolean>;
  first_admin_user_id: string;
  created_at: GeneratedTimestamp;
}

export interface SessionsTable {
  id_hash: Buffer;
  user_id: string;
  csrf_token: string;
  auth_time: Timestamp;
  amr: ColumnType<string[], string[] | undefined, string[]>;
  user_agent: string | null;
  created_at: GeneratedTimestamp;
  last_seen_at: GeneratedTimestamp;
  idle_expires_at: Timestamp;
  absolute_expires_at: Timestamp;
  revoked_at: Timestamp | null;
  revoked_reason: "logout" | "role_changed" | "user_disabled" | "rotated" | "admin" | null;
}

export interface AuthFlowsTable {
  state_hash: Buffer;
  nonce: string;
  code_verifier: string;
  return_to: string;
  created_at: GeneratedTimestamp;
  expires_at: Timestamp;
}

export interface CheckpointDefinitionsTable {
  key: string;
  display_number: string;
  stage_key: string;
  sort_order: number;
  title: string;
  default_responsibility: ResponsibilityValue | null;
  restricted: "fee_proposal" | null;
}

export interface JobsTable {
  id: Generated<string>;
  job_number: string;
  address: string;
  client_name: string | null;
  subdivision_type: string | null;
  approval_date: IsoDate | null;
  approval_expiry: IsoDate | null;
  conformed_date: IsoDate | null;
  conformed_method: ConformedMethodValue | null;
  conformed_file_id: string | null;
  conformed_stamp_text: string | null;
  outcome_date: IsoDate | null;
  conditions_source_file_id: string | null;
  conditions_extracted_at: Timestamp | null;
  created_by: string | null;
  created_at: GeneratedTimestamp;
  updated_at: GeneratedTimestamp;
  deleted_at: Timestamp | null;
  deleted_by: string | null;
  version: Generated<number>;
}

export interface CheckpointStatesTable {
  job_id: string;
  checkpoint_key: string;
  status: ColumnType<CheckpointStatusValue, CheckpointStatusValue | undefined, CheckpointStatusValue>;
  responsibility: ResponsibilityValue | null;
  kr_note: Generated<string>;
  paid_at: Timestamp | null;
  paid_by: string | null;
  decision: "accepted" | "declined" | null;
  decision_comment: Generated<string>;
  decided_at: Timestamp | null;
  decided_by: string | null;
  updated_by: string | null;
  updated_at: GeneratedTimestamp;
  version: Generated<number>;
}

export interface ConditionsTable {
  id: Generated<string>;
  job_id: string;
  condition_number: number;
  text: string;
  agency: string;
  agency_guessed: Generated<boolean>;
  is_cleared: Generated<boolean>;
  cleared_at: Timestamp | null;
  cleared_by: string | null;
  responsibility: "kr" | "client" | null;
  kr_comment: Generated<string>;
  client_comment: Generated<string>;
  extraction_id: string | null;
  superseded_at: Timestamp | null;
  created_at: GeneratedTimestamp;
  updated_at: GeneratedTimestamp;
  updated_by: string | null;
  version: Generated<number>;
}

export interface FilesTable {
  id: Generated<string>;
  job_id: string;
  checkpoint_key: string | null;
  slot: string | null;
  condition_id: string | null;
  storage_key: string;
  original_name: string;
  kind: FileKindValue;
  content_type: string;
  size_bytes: ColumnType<string, number | bigint | string, number | bigint | string>;
  sha256: Buffer;
  scan_status: ColumnType<ScanStatusValue, ScanStatusValue | undefined, ScanStatusValue>;
  scan_detail: string | null;
  scanned_at: Timestamp | null;
  uploaded_by: string | null;
  uploaded_at: GeneratedTimestamp;
  deleted_at: Timestamp | null;
  deleted_by: string | null;
  purged_at: Timestamp | null;
}

export interface EmailMessagesTable {
  file_id: string;
  parse_status: ColumnType<
    "pending" | "parsed" | "failed",
    "pending" | "parsed" | "failed" | undefined,
    "pending" | "parsed" | "failed"
  >;
  subject: string | null;
  from_text: string | null;
  to_text: string | null;
  cc_text: string | null;
  sent_at: Timestamp | null;
  body_text: string | null;
  is_pasted: Generated<boolean>;
  parsed_at: Timestamp | null;
}

export interface JobNotesTable {
  id: Generated<string>;
  job_id: string;
  body: string;
  audience: ColumnType<
    "all" | "surveyor" | "client",
    "all" | "surveyor" | "client" | undefined,
    "all" | "surveyor" | "client"
  >;
  author_id: string | null;
  created_at: GeneratedTimestamp;
  deleted_at: Timestamp | null;
  deleted_by: string | null;
}

export interface AccessGrantsTable {
  id: Generated<string>;
  job_id: string;
  email: string;
  display_name: string | null;
  role: "client" | "architect";
  status: ColumnType<
    "pending" | "active" | "revoked",
    "pending" | "active" | "revoked" | undefined,
    "pending" | "active" | "revoked"
  >;
  user_id: string | null;
  invitation_status: ColumnType<
    "not_sent" | "sent" | "failed",
    "not_sent" | "sent" | "failed" | undefined,
    "not_sent" | "sent" | "failed"
  >;
  invitation_error: string | null;
  invited_by: string | null;
  invited_at: GeneratedTimestamp;
  activated_at: Timestamp | null;
  revoked_at: Timestamp | null;
  revoked_by: string | null;
}

export interface OperationsTable {
  id: Generated<string>;
  job_id: string;
  type: OperationTypeValue;
  status: ColumnType<OperationStatusValue, OperationStatusValue | undefined, OperationStatusValue>;
  payload: ColumnType<unknown, string | undefined, string>;
  result: Json | null;
  error_code: string | null;
  error_message: string | null;
  attempts: Generated<number>;
  max_attempts: Generated<number>;
  run_after: GeneratedTimestamp;
  locked_by: string | null;
  locked_until: Timestamp | null;
  created_by: string | null;
  created_at: GeneratedTimestamp;
  started_at: Timestamp | null;
  completed_at: Timestamp | null;
}

export interface IdempotencyKeysTable {
  user_id: string;
  key: string;
  operation_id: string;
  request_hash: Buffer;
  response_status: number | null;
  response_body: Json | null;
  created_at: GeneratedTimestamp;
}

export interface RateLimitsTable {
  key: string;
  points: Generated<number>;
  expire: string | null;
}

export interface AuditEventsTable {
  id: ColumnType<string, never, never>;
  occurred_at: GeneratedTimestamp;
  actor_user_id: string | null;
  actor_type: "user" | "system";
  action: string;
  job_id: string | null;
  entity_type: string;
  entity_id: string | null;
  request_id: string | null;
  changes: Json | null;
}

export interface Database {
  users: UsersTable;
  system_bootstrap: SystemBootstrapTable;
  sessions: SessionsTable;
  auth_flows: AuthFlowsTable;
  checkpoint_definitions: CheckpointDefinitionsTable;
  jobs: JobsTable;
  checkpoint_states: CheckpointStatesTable;
  conditions: ConditionsTable;
  files: FilesTable;
  email_messages: EmailMessagesTable;
  job_notes: JobNotesTable;
  access_grants: AccessGrantsTable;
  operations: OperationsTable;
  idempotency_keys: IdempotencyKeysTable;
  rate_limits: RateLimitsTable;
  audit_events: AuditEventsTable;
}

export type UserRow = Selectable<UsersTable>;
export type NewUser = Insertable<UsersTable>;
export type UserUpdate = Updateable<UsersTable>;
export type JobRow = Selectable<JobsTable>;
export type NewJob = Insertable<JobsTable>;
export type CheckpointStateRow = Selectable<CheckpointStatesTable>;
export type ConditionRow = Selectable<ConditionsTable>;
export type FileRow = Selectable<FilesTable>;
export type EmailMessageRow = Selectable<EmailMessagesTable>;
export type JobNoteRow = Selectable<JobNotesTable>;
export type AccessGrantRow = Selectable<AccessGrantsTable>;
export type OperationRow = Selectable<OperationsTable>;
export type SessionRow = Selectable<SessionsTable>;
export type AuditEventRow = Selectable<AuditEventsTable>;
export type NewAuditEvent = Insertable<AuditEventsTable>;
