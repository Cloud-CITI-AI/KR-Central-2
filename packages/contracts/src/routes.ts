/**
 * Route registry — every HTTP endpoint of services/api, with its schemas and authorisation rule.
 * - The OpenAPI document is generated from this list (scripts/generate-openapi.ts).
 * - services/api registers one handler per entry; a route-table test asserts that every entry is registered,
 *   that only `auth: "public"` routes skip the session hook, and that every handler declares its authz (API-6/BE-5).
 * - The web client derives typed calls from it.
 * Paths use OpenAPI `{param}` syntax; use `toFastifyPath()` for Fastify.
 */
import type { z } from "zod";
import { CsrfHeader, IdempotencyKeyHeader, IfMatchHeader, PaginationQuery, Problem } from "./common.js";
import * as S from "./schemas.js";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface ResponseDef {
  readonly description: string;
  readonly schema?: z.ZodType;
  /** Defaults to application/json when a schema is present. */
  readonly contentType?: string;
  readonly headers?: Readonly<Record<string, string>>;
}

export interface RouteDef {
  readonly operationId: string;
  readonly method: HttpMethod;
  readonly path: string;
  readonly summary: string;
  readonly tag:
    | "auth"
    | "session"
    | "users"
    | "jobs"
    | "checkpoints"
    | "conditions"
    | "files"
    | "operations"
    | "notes"
    | "access"
    | "audit"
    | "health";
  /** "public" routes are on the explicit allowlist (API-6); everything else requires a valid session. */
  readonly auth: "public" | "session";
  /** Human-readable authorisation rule enforced in the handler (BE-5). */
  readonly authz: string;
  readonly request?: {
    readonly params?: z.ZodType;
    readonly query?: z.ZodType;
    readonly body?: z.ZodType;
    /** multipart/form-data upload (fields described by `body`, one `file` part). */
    readonly multipart?: boolean;
    readonly headers?: z.ZodType;
  };
  readonly responses: Readonly<Record<number, ResponseDef>>;
}

const problem = (description: string): ResponseDef => ({
  description,
  schema: Problem,
  contentType: "application/problem+json",
});

/** Problem responses common to every authenticated route. */
const SESSION_ERRORS = {
  401: problem("No valid session"),
  429: problem("Rate limited"),
  500: problem("Unexpected error (generic body, requestId only)"),
} as const;

const WRITE_ERRORS = {
  ...SESSION_ERRORS,
  400: problem("Validation failed"),
  403: problem("Authenticated but not allowed, or CSRF token missing/invalid"),
} as const;

const JOB_ERRORS = { ...WRITE_ERRORS, 404: problem("Job not found or not visible to the caller") } as const;
const VERSIONED_ERRORS = {
  ...JOB_ERRORS,
  412: problem("If-Match version is stale — reload and retry"),
  428: problem("If-Match header missing"),
} as const;

const csrf = CsrfHeader;
const csrfIfMatch = CsrfHeader.extend(IfMatchHeader.shape);
const csrfIdem = CsrfHeader.extend(IdempotencyKeyHeader.shape);
/** CSRF plus an optional If-Match: honoured when sent (stale → 412), never required (no 428). */
const csrfOptionalIfMatch = CsrfHeader.extend({
  "if-match": IfMatchHeader.shape["if-match"]
    .optional()
    .meta({ description: 'Optional current version, quoted (e.g. "3"). Stale → 412; omitted → last write wins.' }),
});

export const ROUTES = [
  // ------------------------------------------------------------ health (not proxied by the web app)
  {
    operationId: "getLiveness",
    method: "GET",
    path: "/healthz",
    summary: "Liveness probe",
    tag: "health",
    auth: "public",
    authz: "public",
    responses: { 200: { description: "Process is up", schema: S.HealthResponse } },
  },
  {
    operationId: "getReadiness",
    method: "GET",
    path: "/readyz",
    summary: "Readiness probe (database reachable)",
    tag: "health",
    auth: "public",
    authz: "public",
    responses: {
      200: { description: "Ready", schema: S.HealthResponse },
      503: { description: "Not ready", schema: S.HealthResponse },
    },
  },
  // ------------------------------------------------------------ auth (OIDC with Microsoft Entra ID)
  {
    operationId: "startLogin",
    method: "GET",
    path: "/v1/auth/login",
    summary: "Start sign-in: redirect to Microsoft Entra ID (authorization code + PKCE)",
    tag: "auth",
    auth: "public",
    authz: "public; rate limited per IP",
    request: { query: S.AuthLoginQuery },
    responses: {
      302: { description: "Redirect to the Entra authorize endpoint" },
      400: problem("Invalid returnTo"),
      429: problem("Rate limited"),
    },
  },
  {
    operationId: "completeLogin",
    method: "GET",
    path: "/v1/auth/callback",
    summary: "OIDC redirect URI: validates state/nonce/PKCE/id_token, creates the session cookie",
    tag: "auth",
    auth: "public",
    authz: "public; validates state, nonce, issuer, audience, tid, PKCE",
    request: { query: S.AuthCallbackQuery },
    responses: {
      302: {
        description: "Redirect to returnTo (or /sign-in-error?reason=… on failure)",
        headers: { "Set-Cookie": "__Host-kr_session (HttpOnly; Secure; SameSite=Lax; Path=/)" },
      },
      429: problem("Rate limited"),
    },
  },
  {
    operationId: "logout",
    method: "POST",
    path: "/v1/auth/logout",
    summary: "End the session and return the Entra end-session URL",
    tag: "auth",
    auth: "session",
    authz: "any signed-in user (own session)",
    request: { headers: csrf },
    responses: { 200: { description: "Session revoked; cookie cleared", schema: S.LogoutResponse }, ...WRITE_ERRORS },
  },
  // ------------------------------------------------------------ session
  {
    operationId: "getMe",
    method: "GET",
    path: "/v1/me",
    summary: "Current user, global capabilities, CSRF token and feature flags",
    tag: "session",
    auth: "session",
    authz: "any signed-in user",
    responses: { 200: { description: "Current session", schema: S.Me }, ...SESSION_ERRORS },
  },
  // ------------------------------------------------------------ users (admin)
  {
    operationId: "listUsers",
    method: "GET",
    path: "/v1/users",
    summary: "List users",
    tag: "users",
    auth: "session",
    authz: "global capability users.manage",
    request: { query: S.UserListQuery },
    responses: { 200: { description: "Users", schema: S.UserPage }, ...WRITE_ERRORS },
  },
  {
    operationId: "updateUser",
    method: "PATCH",
    path: "/v1/users/{userId}",
    summary: "Change a user's role or disable/enable them (rotates/revokes their sessions)",
    tag: "users",
    auth: "session",
    authz: "global capability users.manage; cannot change own role/status; cannot remove the last active admin",
    request: { params: S.UserIdParams, body: S.UpdateUserRequest, headers: csrfOptionalIfMatch },
    responses: {
      200: { description: "Updated user (ETag carries the new version)", schema: S.ManagedUser },
      ...WRITE_ERRORS,
      404: problem("User not found"),
      409: problem("Would remove the last admin"),
      412: problem("If-Match was sent and is stale — reload and retry"),
    },
  },
  // ------------------------------------------------------------ jobs
  {
    operationId: "listJobs",
    method: "GET",
    path: "/v1/jobs",
    summary: "Dashboard cards / job picker (jobs visible to the caller)",
    tag: "jobs",
    auth: "session",
    authz: "jobs.read_all sees every active job; externals see jobs with an active grant",
    request: { query: S.JobListQuery },
    responses: { 200: { description: "Job cards", schema: S.JobPage }, ...WRITE_ERRORS },
  },
  {
    operationId: "getJobFacets",
    method: "GET",
    path: "/v1/jobs/facets",
    summary: "Dashboard counts: status filter counts, type chip counts, waiting on client, need attention",
    tag: "jobs",
    auth: "session",
    authz: "same visibility as listJobs",
    request: { query: S.JobFacetsQuery },
    responses: { 200: { description: "Counts", schema: S.JobFacets }, ...WRITE_ERRORS },
  },
  {
    operationId: "createJob",
    method: "POST",
    path: "/v1/jobs",
    summary: "Create a job (seeds all 46 checkpoints with default responsibilities)",
    tag: "jobs",
    auth: "session",
    authz: "global capability jobs.create",
    request: { body: S.CreateJobRequest, headers: csrfIdem },
    responses: {
      201: {
        description: "Created",
        schema: S.JobDetail,
        headers: { Location: "/v1/jobs/{jobId}", ETag: '"<version>"' },
      },
      ...WRITE_ERRORS,
      409: problem("Job number already in use"),
    },
  },
  {
    operationId: "getJob",
    method: "GET",
    path: "/v1/jobs/{jobId}",
    summary: "Full tracker view of one job",
    tag: "jobs",
    auth: "session",
    authz: "job capability job.read (404 when none)",
    request: { params: S.JobIdParams },
    responses: { 200: { description: "Job", schema: S.JobDetail, headers: { ETag: '"<version>"' } }, ...JOB_ERRORS },
  },
  {
    operationId: "updateJob",
    method: "PATCH",
    path: "/v1/jobs/{jobId}",
    summary: "Edit job details and WAPC dates (approval, expiry, conformed, outcome)",
    tag: "jobs",
    auth: "session",
    authz: "job capability job.edit",
    request: { params: S.JobIdParams, body: S.UpdateJobRequest, headers: csrfIfMatch },
    responses: {
      200: { description: "Updated job", schema: S.JobDetail },
      ...VERSIONED_ERRORS,
      409: problem("Job number already in use"),
    },
  },
  {
    operationId: "deleteJob",
    method: "DELETE",
    path: "/v1/jobs/{jobId}",
    summary: "Archive (soft-delete) a job",
    tag: "jobs",
    auth: "session",
    authz: "job capability job.delete",
    request: { params: S.JobIdParams, headers: csrfIfMatch },
    responses: { 204: { description: "Archived" }, ...VERSIONED_ERRORS },
  },
  {
    operationId: "downloadJobPackage",
    method: "GET",
    path: "/v1/jobs/{jobId}/package",
    summary: "Download every clean file on the job as one .zip laid out like the page, plus 'Job summary.txt'",
    tag: "jobs",
    auth: "session",
    authz: "job capability package.download; restricted files (fee proposal) included only with fee_proposal.view",
    request: { params: S.JobIdParams },
    responses: { 200: { description: "Streamed zip", contentType: "application/zip" }, ...JOB_ERRORS },
  },
  // ------------------------------------------------------------ checkpoints
  {
    operationId: "updateCheckpoint",
    method: "PATCH",
    path: "/v1/jobs/{jobId}/checkpoints/{checkpointKey}",
    summary: "Set status, responsibility or KR note on a checkpoint",
    tag: "checkpoints",
    auth: "session",
    authz:
      "status → checkpoint.status.edit; responsibility → checkpoint.responsibility.edit; krNote → checkpoint.kr_note.edit; fee proposal also needs fee_proposal.view",
    request: { params: S.JobCheckpointParams, body: S.UpdateCheckpointRequest, headers: csrfIfMatch },
    responses: { 200: { description: "Updated checkpoint", schema: S.CheckpointState }, ...VERSIONED_ERRORS },
  },
  {
    operationId: "recordDecision",
    method: "PUT",
    path: "/v1/jobs/{jobId}/checkpoints/{checkpointKey}/decision",
    summary: "Record the client's approve/accept or decline decision (decline needs a comment)",
    tag: "checkpoints",
    auth: "session",
    authz:
      "checkpoint.decision.record; checkpoint must have an approval panel; fee proposal also needs fee_proposal.view",
    request: { params: S.JobCheckpointParams, body: S.RecordDecisionRequest, headers: csrf },
    responses: {
      200: { description: "Updated checkpoint", schema: S.CheckpointState },
      ...JOB_ERRORS,
      409: problem("Checkpoint has no approval panel"),
    },
  },
  {
    operationId: "markPaid",
    method: "PUT",
    path: "/v1/jobs/{jobId}/checkpoints/{checkpointKey}/paid",
    summary:
      "Client response button (INVOICE PAID / WORKS COMPLETE / …): records the time and marks the checkpoint Completed",
    tag: "checkpoints",
    auth: "session",
    authz: "checkpoint.paid.record; checkpoint must have a paid panel",
    request: { params: S.JobCheckpointParams, headers: csrf },
    responses: {
      200: { description: "Updated checkpoint", schema: S.CheckpointState },
      ...JOB_ERRORS,
      409: problem("Checkpoint has no paid panel"),
    },
  },
  {
    operationId: "undoPaid",
    method: "DELETE",
    path: "/v1/jobs/{jobId}/checkpoints/{checkpointKey}/paid",
    summary: "Undo the client response: clears it and sets the checkpoint back to Not completed",
    tag: "checkpoints",
    auth: "session",
    authz: "checkpoint.paid.record",
    request: { params: S.JobCheckpointParams, headers: csrf },
    responses: { 200: { description: "Updated checkpoint", schema: S.CheckpointState }, ...JOB_ERRORS },
  },
  {
    operationId: "pasteEmail",
    method: "POST",
    path: "/v1/jobs/{jobId}/emails",
    summary: "Add a WAPC query email from pasted text (4.3)",
    tag: "checkpoints",
    auth: "session",
    authz: "job capability emails.add",
    request: { params: S.JobIdParams, body: S.PasteEmailRequest, headers: csrf },
    responses: { 201: { description: "Stored as a text file with email metadata", schema: S.FileMeta }, ...JOB_ERRORS },
  },
  {
    operationId: "startConformanceReading",
    method: "POST",
    path: "/v1/jobs/{jobId}/conformance-readings",
    summary:
      "Read the conformed date from a Conformance Notification (file name → stamp annotation → AI stamp reading → text)",
    tag: "checkpoints",
    auth: "session",
    authz: "job capability conformance.read; file must be a clean PDF in slot i4_2/conformance of this job",
    request: { params: S.JobIdParams, body: S.StartConformanceReadingRequest, headers: csrf },
    responses: {
      202: { description: "Queued", schema: S.Operation },
      ...JOB_ERRORS,
      409: problem("File not ready or not a conformance PDF"),
    },
  },
  // ------------------------------------------------------------ conditions
  {
    operationId: "startConditionsExtraction",
    method: "POST",
    path: "/v1/jobs/{jobId}/conditions/extractions",
    summary: "Extract numbered conditions, approval date and expiry from the WAPC Decision Letter",
    tag: "conditions",
    auth: "session",
    authz:
      "job capability conditions.extract; file must be a clean PDF in slot i5_0/decision whose name contains 'decision'",
    request: { params: S.JobIdParams, body: S.StartConditionsExtractionRequest, headers: csrf },
    responses: {
      202: { description: "Queued", schema: S.Operation },
      ...JOB_ERRORS,
      409: problem("Conditions exist and replaceExisting is false, or the file is not a ready Decision Letter"),
    },
  },
  {
    operationId: "updateCondition",
    method: "PATCH",
    path: "/v1/jobs/{jobId}/conditions/{conditionId}",
    summary: "Tick/untick, set responsibility, agency, KR or client comment on a condition",
    tag: "conditions",
    auth: "session",
    authz: "clientComment → conditions.client_comment.edit; every other field → conditions.edit",
    request: { params: S.JobConditionParams, body: S.UpdateConditionRequest, headers: csrfIfMatch },
    responses: { 200: { description: "Updated condition", schema: S.Condition }, ...VERSIONED_ERRORS },
  },
  // ------------------------------------------------------------ files
  {
    operationId: "uploadFile",
    method: "POST",
    path: "/v1/jobs/{jobId}/files",
    summary: "Upload one file into a checkpoint slot or as evidence for a condition (multipart, single `file` part)",
    tag: "files",
    auth: "session",
    authz:
      "slot uploaders 'staff' → files.upload.staff_slots; 'staff_and_client' → files.upload.client_slots; condition evidence → conditions.evidence.upload",
    request: { params: S.JobIdParams, body: S.UploadFields, multipart: true, headers: csrf },
    responses: {
      201: { description: "Stored; scanning starts", schema: S.UploadResult },
      ...JOB_ERRORS,
      413: problem("File larger than UPLOAD_MAX_BYTES"),
      415: problem("Content type not accepted by this slot (sniffed, not trusted from the name)"),
    },
  },
  {
    operationId: "getFile",
    method: "GET",
    path: "/v1/files/{fileId}",
    summary: "File metadata (poll scanStatus / email parseStatus)",
    tag: "files",
    auth: "session",
    authz: "job.read on the file's job; restricted checkpoint files need fee_proposal.view",
    request: { params: S.FileIdParams },
    responses: { 200: { description: "File", schema: S.FileMeta }, ...SESSION_ERRORS, 404: problem("Not found") },
  },
  {
    operationId: "getFileContent",
    method: "GET",
    path: "/v1/files/{fileId}/content",
    summary:
      "Stream file content (Range supported). inline only for PDF, images, video and text; everything else is an attachment",
    tag: "files",
    auth: "session",
    authz: "same as getFile; content only when scanStatus is clean or skipped",
    request: { params: S.FileIdParams, query: S.FileContentQuery },
    responses: {
      200: { description: "File bytes", contentType: "application/octet-stream" },
      206: { description: "Partial content", contentType: "application/octet-stream" },
      ...SESSION_ERRORS,
      404: problem("Not found"),
      409: problem("Scan pending or file rejected"),
    },
  },
  {
    operationId: "deleteFile",
    method: "DELETE",
    path: "/v1/files/{fileId}",
    summary: "Remove a file (soft delete; object deleted by the retention sweep)",
    tag: "files",
    auth: "session",
    authz: "files.delete.any, or files.delete.own for files the caller uploaded",
    request: { params: S.FileIdParams, headers: csrf },
    responses: { 204: { description: "Removed" }, ...WRITE_ERRORS, 404: problem("Not found") },
  },
  // ------------------------------------------------------------ operations
  {
    operationId: "getOperation",
    method: "GET",
    path: "/v1/operations/{operationId}",
    summary: "Status of an asynchronous operation (extraction, conformance read, email parse, scan)",
    tag: "operations",
    auth: "session",
    authz: "job.read on the operation's job",
    request: { params: S.OperationIdParams },
    responses: { 200: { description: "Operation", schema: S.Operation }, ...SESSION_ERRORS, 404: problem("Not found") },
  },
  // ------------------------------------------------------------ notes
  {
    operationId: "listNotes",
    method: "GET",
    path: "/v1/jobs/{jobId}/notes",
    summary: "Job notes, newest first",
    tag: "notes",
    auth: "session",
    authz: "job capability job.read",
    request: { params: S.JobIdParams, query: PaginationQuery },
    responses: { 200: { description: "Notes", schema: S.JobNotePage }, ...JOB_ERRORS },
  },
  {
    operationId: "createNote",
    method: "POST",
    path: "/v1/jobs/{jobId}/notes",
    summary: "Add a job note",
    tag: "notes",
    auth: "session",
    authz: "job capability notes.create",
    request: { params: S.JobIdParams, body: S.CreateNoteRequest, headers: csrfIdem },
    responses: { 201: { description: "Created", schema: S.JobNote }, ...JOB_ERRORS },
  },
  {
    operationId: "deleteNote",
    method: "DELETE",
    path: "/v1/jobs/{jobId}/notes/{noteId}",
    summary: "Delete a note (own notes, or any note with notes.delete.any)",
    tag: "notes",
    auth: "session",
    authz: "author, or notes.delete.any",
    request: { params: S.JobNoteParams, headers: csrf },
    responses: { 204: { description: "Deleted" }, ...JOB_ERRORS },
  },
  // ------------------------------------------------------------ access grants (access manager)
  {
    operationId: "listAccessGrants",
    method: "GET",
    path: "/v1/access-grants",
    summary: "People granted access to jobs (access manager list)",
    tag: "access",
    auth: "session",
    authz: "global capability access.manage",
    request: { query: S.AccessGrantListQuery },
    responses: { 200: { description: "Grants", schema: S.AccessGrantPage }, ...WRITE_ERRORS },
  },
  {
    operationId: "createAccessGrant",
    method: "POST",
    path: "/v1/access-grants",
    summary:
      "Grant a client or architect access to one job (activates when they first sign in; optional Entra B2B invitation)",
    tag: "access",
    auth: "session",
    authz: "global capability access.manage",
    request: { body: S.CreateAccessGrantRequest, headers: csrfIdem },
    responses: {
      201: { description: "Created", schema: S.AccessGrant },
      ...WRITE_ERRORS,
      404: problem("Job not found"),
      409: problem("Already on the list for that job"),
    },
  },
  {
    operationId: "revokeAccessGrant",
    method: "DELETE",
    path: "/v1/access-grants/{grantId}",
    summary: "Revoke a grant (takes effect on the user's next request)",
    tag: "access",
    auth: "session",
    authz: "global capability access.manage",
    request: { params: S.GrantIdParams, headers: csrf },
    responses: { 204: { description: "Revoked" }, ...WRITE_ERRORS, 404: problem("Not found") },
  },
  // ------------------------------------------------------------ audit
  {
    operationId: "listAuditEvents",
    method: "GET",
    path: "/v1/audit-events",
    summary: "Audit trail (newest first)",
    tag: "audit",
    auth: "session",
    authz: "global capability audit.read",
    request: { query: S.AuditEventListQuery },
    responses: { 200: { description: "Events", schema: S.AuditEventPage }, ...WRITE_ERRORS },
  },
] as const satisfies readonly RouteDef[];

export type Route = (typeof ROUTES)[number];
export type OperationId = Route["operationId"];

export function getRoute(operationId: OperationId): RouteDef {
  const r = ROUTES.find((x) => x.operationId === operationId);
  if (!r) throw new RangeError(`Unknown operation ${operationId}`);
  return r;
}

/** "/v1/jobs/{jobId}" → "/v1/jobs/:jobId" */
export function toFastifyPath(path: string): string {
  return path.replace(/\{(\w+)\}/g, ":$1");
}

/** Fill path params: buildPath("/v1/jobs/{jobId}", { jobId }) */
export function buildPath(path: string, params: Readonly<Record<string, string>>): string {
  return path.replace(/\{(\w+)\}/g, (_, k: string) => {
    const v = params[k];
    if (v === undefined) throw new RangeError(`Missing path param ${k}`);
    return encodeURIComponent(v);
  });
}

/** Paths reachable without a session (API-6 allowlist). */
export const PUBLIC_PATHS: readonly string[] = ROUTES.filter((r) => r.auth === "public").map((r) => r.path);
