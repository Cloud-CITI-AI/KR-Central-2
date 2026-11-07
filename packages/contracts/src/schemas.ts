/**
 * Request/response schemas for every API resource. The OpenAPI document is generated from these
 * (scripts/generate-openapi.ts) — never edit openapi.yaml by hand (X10).
 */
import { z } from "zod";
import {
  AGENCIES,
  CHECKPOINT_KEYS,
  CHECKPOINT_STATUSES,
  CONDITION_RESPONSIBILITIES,
  FILE_KINDS,
  RESPONSIBILITIES,
  STAGE_KEYS,
  SUBDIVISION_TYPES,
} from "@kr/workflow";
import {
  IsoDate,
  IsoDateTime,
  LongText,
  PaginationQuery,
  ShortText,
  UserRef,
  Uuid,
  Version,
  isBlank,
  page,
} from "./common.js";
import { GlobalCapability, GlobalRole, GrantRole, JobCapability } from "./permissions.js";

// ---------------------------------------------------------------- enums from the workflow package
export const CheckpointStatus = z.enum(CHECKPOINT_STATUSES).meta({ id: "CheckpointStatus" });
export const Responsibility = z.enum(RESPONSIBILITIES).meta({ id: "Responsibility" });
export const ConditionResponsibility = z.enum(CONDITION_RESPONSIBILITIES).meta({ id: "ConditionResponsibility" });
export const Agency = z.enum(AGENCIES).meta({ id: "Agency" });
export const SubdivisionType = z.enum(SUBDIVISION_TYPES).meta({ id: "SubdivisionType" });
export const StageKey = z.enum(STAGE_KEYS).meta({ id: "StageKey" });
export const FileKind = z.enum(FILE_KINDS).meta({ id: "FileKind" });
export const CheckpointKey = z
  .enum(CHECKPOINT_KEYS as [string, ...string[]])
  .meta({ id: "CheckpointKey", description: "Workflow storage key (e.g. i13_2 for display number 12.3)" });

// ---------------------------------------------------------------- users & session
export const UserStatus = z.enum(["active", "disabled"]).meta({ id: "UserStatus" });

export const User = z
  .object({
    id: Uuid,
    displayName: z.string(),
    email: z
      .string()
      .nullable()
      .meta({ description: "Email from the IdP (shown to admins and in the access manager only)" }),
    role: GlobalRole,
    isGuest: z.boolean().meta({ description: "Entra B2B guest (external) account" }),
    status: UserStatus,
    lastSignInAt: IsoDateTime.nullable(),
    createdAt: IsoDateTime,
  })
  .meta({ id: "User" });
export type User = z.infer<typeof User>;

export const Features = z
  .object({
    aiStampReading: z
      .boolean()
      .meta({ description: "Claude vision reads the conformance stamp (flag ai-stamp-reading)" }),
    guestInvites: z
      .boolean()
      .meta({ description: "Granting access sends an Entra B2B invitation (flag entra-guest-invites)" }),
    malwareScanning: z.boolean().meta({ description: "Uploads are scanned before they can be opened" }),
    teamsFileSync: z.boolean().meta({
      description:
        "The Teams integration exists in this deployment (flag teams-file-sync, ADR-0015); whether it runs is set under Admin → Teams",
    }),
  })
  .meta({ id: "Features" });

export const Me = z
  .object({
    user: User,
    capabilities: z.array(GlobalCapability),
    csrfToken: z.string().meta({ description: "Send as X-CSRF-Token on every POST/PUT/PATCH/DELETE" }),
    features: Features,
    uploadMaxBytes: z.number().int().positive(),
    sessionExpiresAt: IsoDateTime,
  })
  .meta({ id: "Me" });
export type Me = z.infer<typeof Me>;

export const LogoutResponse = z
  .object({ redirectTo: z.url().meta({ description: "Entra end-session URL to navigate to" }) })
  .meta({ id: "LogoutResponse" });

export const UserListQuery = PaginationQuery.extend({
  q: z.string().trim().max(100).optional(),
  role: GlobalRole.optional(),
});
/**
 * A user as the admin user list and updateUser return it: User plus the row version, so a client can send
 * If-Match on updateUser. A superset of User (Me.user stays User).
 */
export const ManagedUser = User.extend({ version: Version }).meta({ id: "ManagedUser" });
export type ManagedUser = z.infer<typeof ManagedUser>;
export const UserPage = page(ManagedUser, "UserPage");

export const UpdateUserRequest = z
  .strictObject({ role: GlobalRole.optional(), status: UserStatus.optional() })
  .refine((v) => v.role !== undefined || v.status !== undefined, { message: "Provide role or status" })
  .meta({ id: "UpdateUserRequest" });

// ---------------------------------------------------------------- files
export const ScanStatus = z
  .enum(["pending", "clean", "infected", "error", "skipped"])
  .meta({ id: "ScanStatus", description: "Malware scan state. Content is downloadable only when clean or skipped." });

export const EmailMeta = z
  .object({
    parseStatus: z.enum(["pending", "parsed", "failed"]),
    subject: z.string().nullable(),
    from: z.string().nullable(),
    to: z.string().nullable(),
    cc: z.string().nullable(),
    sentAt: IsoDateTime.nullable(),
    isPasted: z.boolean(),
    bodyText: z.string().nullable().meta({
      description:
        "The parsed message text the viewer shows under the header block. Null until parsed, when the message has no text, and while the file's scan state blocks it (same rule as the content route).",
    }),
  })
  .meta({ id: "EmailMeta" });

export const FileMeta = z
  .object({
    id: Uuid,
    jobId: Uuid,
    checkpointKey: CheckpointKey.nullable(),
    conditionId: Uuid.nullable(),
    slot: z.string().nullable(),
    name: z.string().meta({ description: "Original file name (sanitised)" }),
    kind: FileKind,
    contentType: z.string().meta({ description: "Sniffed media type" }),
    sizeBytes: z.number().int().nonnegative(),
    scanStatus: ScanStatus,
    scanRetriesExhausted: z.boolean().meta({
      description:
        "Meaningful when scanStatus is 'error': true once no automatic re-scan is left, so the file must be removed and uploaded again; false while the hourly sweep will still try it",
    }),
    uploadedAt: IsoDateTime,
    uploadedBy: UserRef.nullable(),
    canDelete: z.boolean().meta({ description: "Whether the current user may delete this file" }),
    email: EmailMeta.nullable(),
    source: z.enum(["upload", "teams"]).default("upload").meta({
      description: "teams: the file was added in the linked Teams channel and brought into the tracker (phase 2)",
    }),
    teamsState: z.enum(["pushed", "pending", "failed", "excluded", "removed", "changed"]).nullable().meta({
      description:
        "The file's copy in Teams (ADR-0015, §5.10 badges): pushed, pending (waiting or uploading), failed, excluded by policy; removed = deleted in Teams; changed = edited in Teams so not removed there. null: the job is not linked or the viewer cannot see the panel",
    }),
  })
  .meta({ id: "FileMeta" });
export type FileMeta = z.infer<typeof FileMeta>;

export const UploadFields = z
  .strictObject({
    checkpointKey: CheckpointKey.optional(),
    slot: z.string().min(1).max(40).optional(),
    conditionId: Uuid.optional(),
  })
  .refine((v) => (v.conditionId ? !v.checkpointKey && !v.slot : Boolean(v.checkpointKey && v.slot)), {
    message: "Send either checkpointKey + slot, or conditionId",
  })
  .meta({ id: "UploadFields", description: "Multipart text fields sent before the single `file` part" });

export const FileContentQuery = z.strictObject({
  disposition: z.enum(["inline", "attachment"]).default("inline"),
});

// ---------------------------------------------------------------- operations (async jobs)
export const OperationType = z
  .enum([
    "conditions.extract",
    "conformance.read",
    "email.parse",
    "file.scan",
    "teams.provision",
    "teams.push",
    "teams.check",
    "teams.poll",
    "teams.create_channel",
    "teams.list_channels",
  ])
  .meta({ id: "OperationType" });
export const OperationStatus = z.enum(["queued", "running", "succeeded", "failed"]).meta({ id: "OperationStatus" });

export const ConditionsExtractResult = z
  .object({
    conditionsCount: z.number().int().nonnegative(),
    guessedNumbers: z.array(z.number().int()),
    approvalDate: IsoDate.nullable(),
    approvalExpiry: IsoDate.nullable(),
    message: z
      .string()
      .nullable()
      .meta({ description: "User-facing note, e.g. 'Check the agency for conditions 3, 7 …'" }),
  })
  .meta({ id: "ConditionsExtractResult" });

export const ConformanceMethod = z
  .enum(["manual", "file_name", "stamp_annotation", "stamp_image", "text"])
  .meta({ id: "ConformanceMethod" });

export const ConformanceReadResult = z
  .object({
    found: z.boolean(),
    date: IsoDate.nullable(),
    method: ConformanceMethod.nullable(),
    stampText: z.string().nullable(),
    message: z.string().meta({ description: "User-facing message shown under the drop zone" }),
  })
  .meta({ id: "ConformanceReadResult" });

export const FileScanResult = z
  .object({
    scanStatus: z.enum(["clean", "skipped", "infected", "gone"]).meta({
      description: "Scan outcome. `gone`: the file was deleted or purged before it could be scanned.",
    }),
    followUpOperationId: Uuid.nullable().meta({
      description:
        "The task the scan queued for this file (a conformance read or an email parse), or the one already queued; " +
        "null when none. Follow it with getOperation.",
    }),
  })
  .meta({ id: "FileScanResult" });

/** One check of the Teams settings page's Test connection (PRODUCT_SPEC §9.3), in the order the worker ran them. */
export const TeamsCheckItem = z
  .object({
    item: z
      .enum(["token", "team_site", "team_site_write", "fee_site", "fee_site_write", "channel_list", "channel_create"])
      .meta({ description: "Which check; the page shows its §9.3 label" }),
    ok: z.boolean(),
    errorCode: z
      .string()
      .nullable()
      .meta({ description: "HTTP status and Graph error code of a failed check, e.g. 403 accessDenied; null when ok" }),
  })
  .meta({ id: "TeamsCheckItem" });

export const TeamsCheckResult = z
  .object({
    results: z.array(TeamsCheckItem),
    /** Checks not run because a prerequisite failed, or because the phase is off, are listed here. */
    skipped: z.array(TeamsCheckItem.shape.item),
  })
  .meta({ id: "TeamsCheckResult" });
export type TeamsCheckResult = z.infer<typeof TeamsCheckResult>;

export const TeamsProvisionResult = z
  .object({
    status: z
      .enum(["ready", "error", "skipped"])
      .meta({ description: "skipped: sync is off or the job is not linked" }),
    foldersCreated: z.number().int().nonnegative(),
    filesQueued: z.number().int().nonnegative(),
    errorCode: z.string().nullable(),
  })
  .meta({ id: "TeamsProvisionResult" });
export type TeamsProvisionResult = z.infer<typeof TeamsProvisionResult>;

export const TeamsPushResult = z
  .object({
    pushed: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    skipped: z
      .number()
      .int()
      .nonnegative()
      .meta({ description: "Rows left alone (sync off, link not ready, archived)" }),
    deleted: z
      .number()
      .int()
      .nonnegative()
      .default(0)
      .meta({ description: "Items removed from Teams after an app delete" }),
  })
  .meta({ id: "TeamsPushResult" });
export type TeamsPushResult = z.infer<typeof TeamsPushResult>;

export const TeamsPollResult = z
  .object({
    imported: z.number().int().nonnegative(),
    unfiled: z.number().int().nonnegative(),
    replaced: z.number().int().nonnegative(),
    removed: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    skipped: z.boolean().meta({ description: "True when inbound sync is off or the job is not linked" }),
  })
  .meta({ id: "TeamsPollResult" });
export type TeamsPollResult = z.infer<typeof TeamsPollResult>;

export const TeamsChannelCreateResult = z
  .object({
    status: z.enum(["created", "error", "skipped"]),
    channelName: z.string().nullable(),
    errorCode: z.string().nullable(),
  })
  .meta({ id: "TeamsChannelCreateResult" });
export type TeamsChannelCreateResult = z.infer<typeof TeamsChannelCreateResult>;

export const TeamsListChannelsResult = z
  .object({ channels: z.number().int().nonnegative() })
  .meta({ id: "TeamsListChannelsResult" });
export type TeamsListChannelsResult = z.infer<typeof TeamsListChannelsResult>;

export const Operation = z
  .object({
    id: Uuid,
    jobId: Uuid.nullable().meta({ description: "null for a global task (teams.check)" }),
    type: OperationType,
    status: OperationStatus,
    createdAt: IsoDateTime,
    completedAt: IsoDateTime.nullable(),
    result: z
      .union([
        ConditionsExtractResult,
        ConformanceReadResult,
        FileScanResult,
        TeamsCheckResult,
        TeamsProvisionResult,
        TeamsPushResult,
        TeamsPollResult,
        TeamsChannelCreateResult,
        TeamsListChannelsResult,
      ])
      .nullable(),
    error: z.object({ code: z.string(), message: z.string() }).nullable(),
  })
  .meta({ id: "Operation" });
export type Operation = z.infer<typeof Operation>;

/** A document reading the job page must keep showing across a reload (GET /v1/jobs/{id} -> poll GET /v1/operations/{id}). */
export const ActiveOperation = z
  .object({
    id: Uuid,
    type: z.enum(["conditions.extract", "conformance.read"]),
    status: z.enum(["queued", "running"]),
  })
  .meta({
    id: "ActiveOperation",
    description:
      "A conditions extraction or conformed-date reading of this job that is queued or running; poll getOperation with its id",
  });
export type ActiveOperation = z.infer<typeof ActiveOperation>;

export const UploadResult = z
  .object({
    file: FileMeta,
    operation: Operation.nullable().meta({
      description: "Follow-up work started by the upload (conformance read, email parse)",
    }),
  })
  .meta({ id: "UploadResult" });

// ---------------------------------------------------------------- checkpoints
export const Decision = z
  .object({
    value: z.enum(["accepted", "declined"]),
    comment: z.string(),
    at: IsoDateTime,
    by: UserRef.nullable(),
  })
  .meta({ id: "Decision" });

export const Paid = z.object({ at: IsoDateTime, by: UserRef.nullable() }).meta({ id: "Paid" });

export const CheckpointState = z
  .object({
    key: CheckpointKey,
    status: CheckpointStatus.meta({ description: "Effective status (agency exclusion applied)" }),
    storedStatus: CheckpointStatus,
    excludedByConditions: z.boolean(),
    responsibility: Responsibility.nullable(),
    krNote: z.string(),
    paid: Paid.nullable(),
    decision: Decision.nullable(),
    files: z.array(FileMeta),
    isRestricted: z.boolean().meta({ description: "Panel content and files hidden for this viewer (fee proposal)" }),
    version: Version,
    updatedAt: IsoDateTime,
  })
  .meta({ id: "CheckpointState" });
export type CheckpointState = z.infer<typeof CheckpointState>;

export const UpdateCheckpointRequest = z
  .strictObject({
    status: CheckpointStatus.optional(),
    responsibility: Responsibility.nullable().optional(),
    krNote: LongText(2000).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Provide at least one field" })
  .meta({ id: "UpdateCheckpointRequest" });

export const RecordDecisionRequest = z
  .strictObject({
    value: z.enum(["accepted", "declined"]),
    comment: LongText(2000).default(""),
  })
  .refine((v) => v.value !== "declined" || !isBlank(v.comment), {
    message: "Add a comment explaining why it is declined.",
    path: ["comment"],
  })
  .meta({ id: "RecordDecisionRequest" });

// ---------------------------------------------------------------- conditions
export const Condition = z
  .object({
    id: Uuid,
    number: z.number().int().positive(),
    text: z.string(),
    agency: Agency,
    agencyGuessed: z.boolean(),
    isCleared: z.boolean(),
    responsibility: ConditionResponsibility.nullable(),
    krComment: z.string(),
    clientComment: z.string(),
    evidence: z.array(FileMeta),
    version: Version,
    updatedAt: IsoDateTime,
  })
  .meta({ id: "Condition" });
export type Condition = z.infer<typeof Condition>;

export const UpdateConditionRequest = z
  .strictObject({
    isCleared: z.boolean().optional(),
    responsibility: ConditionResponsibility.nullable().optional(),
    krComment: LongText(4000).optional(),
    clientComment: LongText(4000).optional(),
    agency: Agency.optional(),
    agencyConfirmed: z.literal(true).optional().meta({ description: "Clears the 'agency guessed' flag" }),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Provide at least one field" })
  .meta({ id: "UpdateConditionRequest" });

export const StartConditionsExtractionRequest = z
  .strictObject({
    fileId: Uuid,
    replaceExisting: z
      .boolean()
      .default(false)
      .meta({ description: "Required true when conditions already exist (replaces ticks, comments and evidence)" }),
  })
  .meta({ id: "StartConditionsExtractionRequest" });

export const StartConformanceReadingRequest = z
  .strictObject({ fileId: Uuid })
  .meta({ id: "StartConformanceReadingRequest" });

export const PasteEmailRequest = z
  .strictObject({ text: z.string().trim().min(1).max(100_000) })
  .meta({ id: "PasteEmailRequest" });

// ---------------------------------------------------------------- jobs
export const ProgressSummary = z
  .object({
    completed: z.number().int(),
    notCompleted: z.number().int(),
    notRequired: z.number().int(),
    total: z.number().int(),
    percent: z.number().int().min(0).max(100),
  })
  .meta({ id: "ProgressSummary" });

export const StageSummary = ProgressSummary.extend({
  stage: StageKey,
  state: CheckpointStatus,
  excluded: z.boolean(),
  label: z.string(),
}).meta({ id: "StageSummary" });

export const NextAction = z
  .object({
    checkpointKey: CheckpointKey,
    number: z.string(),
    title: z.string(),
    stage: StageKey,
    stageName: z.string(),
    responsibility: Responsibility.nullable(),
  })
  .meta({ id: "NextAction" });

export const JobAlert = z
  .object({
    code: z.enum([
      "approval_expired",
      "approval_expiring",
      "outcome_passed",
      "outcome_due",
      "client_declined",
      "conditions_agency_unchecked",
    ]),
    level: z.enum(["bad", "warn"]),
    text: z.string(),
    checkpointKey: CheckpointKey.optional(),
  })
  .meta({ id: "JobAlert" });

export const JobCard = z
  .object({
    id: Uuid,
    jobNumber: z.string(),
    address: z.string(),
    clientName: z.string().nullable(),
    subdivisionType: SubdivisionType.nullable(),
    isComplete: z.boolean(),
    progress: ProgressSummary,
    nextActions: z.array(NextAction),
    alerts: z.array(JobAlert),
    isWaitingOnClient: z.boolean(),
    updatedAt: IsoDateTime,
  })
  .meta({ id: "JobCard", description: "Dashboard card / job picker entry" });
export type JobCard = z.infer<typeof JobCard>;

export const JobStatusFilter = z.enum(["in_progress", "complete", "all"]).meta({ id: "JobStatusFilter" });

export const JobListQuery = PaginationQuery.extend({
  status: JobStatusFilter.default("in_progress"),
  type: SubdivisionType.optional(),
  q: z
    .string()
    .trim()
    .max(100)
    .optional()
    .meta({ description: "Matches job number, address or client name (case-insensitive)" }),
  sort: z.enum(["attention", "job_number"]).default("attention").meta({
    description:
      "attention: jobs with most alerts first, then job number (dashboard); job_number: natural order (job picker)",
  }),
});
export const JobPage = page(JobCard, "JobPage");

export const JobFacetsQuery = z.strictObject({ status: JobStatusFilter.default("in_progress") });
export const JobFacets = z
  .object({
    statusCounts: z.object({ in_progress: z.number().int(), complete: z.number().int(), all: z.number().int() }),
    typeCounts: z
      .record(z.string(), z.number().int())
      .meta({ description: "Counts per subdivision type within the status filter; key '' = all types" }),
    waitingOnClient: z.number().int(),
    needAttention: z.number().int(),
  })
  .meta({ id: "JobFacets" });

const JobNumber = z
  .string()
  .trim()
  .min(1)
  .max(32)
  .regex(/^[A-Za-z0-9][A-Za-z0-9 ./-]*$/, "Use letters, numbers, spaces, '-', '.' or '/'")
  .meta({ description: "KR job number, unique among active jobs (case-insensitive)", example: "S-0001" });

export const CreateJobRequest = z
  .strictObject({
    jobNumber: JobNumber,
    address: ShortText(200),
    clientName: ShortText(200).nullable().optional(),
    subdivisionType: SubdivisionType,
    createTeamsChannel: z.boolean().optional().meta({
      description:
        "Phase 3 (ADR-0015 A5): create the job's Teams channel. Honoured only when the integration, copying and channel creation are on; defaults to true then",
    }),
  })
  .meta({ id: "CreateJobRequest" });

export const UpdateJobRequest = z
  .strictObject({
    jobNumber: JobNumber.optional(),
    address: ShortText(200).optional(),
    clientName: ShortText(200).nullable().optional(),
    subdivisionType: SubdivisionType.optional(),
    approvalDate: IsoDate.nullable().optional(),
    approvalExpiry: IsoDate.nullable().optional(),
    conformedDate: IsoDate.nullable().optional().meta({
      description:
        "Setting it records method 'manual' and sets outcomeDate = conformedDate + 90 days unless outcomeDate is also sent",
    }),
    outcomeDate: IsoDate.nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Provide at least one field" })
  .meta({ id: "UpdateJobRequest" });

export const ConformedSource = z
  .object({ method: ConformanceMethod, fileName: z.string().nullable(), stampText: z.string().nullable() })
  .meta({ id: "ConformedSource" });

export const JobDetail = z
  .object({
    id: Uuid,
    jobNumber: z.string(),
    address: z.string(),
    clientName: z.string().nullable(),
    subdivisionType: SubdivisionType.nullable(),
    approvalDate: IsoDate.nullable(),
    approvalExpiry: IsoDate.nullable(),
    conformedDate: IsoDate.nullable(),
    conformedSource: ConformedSource.nullable(),
    outcomeDate: IsoDate.nullable(),
    conditionsSource: z.object({ fileId: Uuid, fileName: z.string(), extractedAt: IsoDateTime }).nullable(),
    checkpoints: z.array(CheckpointState).meta({ description: "All 46 checkpoints in workflow order" }),
    conditions: z.array(Condition),
    activeOperations: z.array(ActiveOperation).meta({
      description:
        "Readings of the Decision Letter or Conformance Notification still queued or running, oldest first. At most one of each type: a second start request is answered 409 while one is active",
    }),
    summary: z.object({
      progress: ProgressSummary,
      stages: z.array(StageSummary),
      isComplete: z.boolean(),
      alerts: z.array(JobAlert),
      fileCount: z.number().int().meta({ description: "Files the viewer can download in the job package" }),
    }),
    capabilities: z.array(JobCapability),
    viewerGrantRole: GrantRole.nullable(),
    version: Version,
    createdAt: IsoDateTime,
    updatedAt: IsoDateTime,
  })
  .meta({ id: "JobDetail" });
export type JobDetail = z.infer<typeof JobDetail>;

// ---------------------------------------------------------------- notes
export const NoteAudience = z
  .enum(["all", "surveyor", "client"])
  .meta({ id: "NoteAudience", description: "Label only — every party on the job can read every note" });

export const JobNote = z
  .object({
    id: Uuid,
    jobId: Uuid,
    body: z.string(),
    audience: NoteAudience,
    author: UserRef.nullable(),
    isOwn: z.boolean(),
    canDelete: z.boolean(),
    createdAt: IsoDateTime,
  })
  .meta({ id: "JobNote" });
export const JobNotePage = page(JobNote, "JobNotePage");
export const CreateNoteRequest = z
  .strictObject({
    body: z.string().trim().min(1, "Type a note first.").max(5000),
    audience: NoteAudience.default("all"),
  })
  .meta({ id: "CreateNoteRequest" });

// ---------------------------------------------------------------- access grants
export const GrantStatus = z.enum(["pending", "active", "revoked"]).meta({ id: "GrantStatus" });
export const InvitationStatus = z.enum(["not_sent", "sent", "failed"]).meta({ id: "InvitationStatus" });

export const AccessGrant = z
  .object({
    id: Uuid,
    jobId: Uuid,
    jobNumber: z.string(),
    email: z.string(),
    displayName: z.string().nullable(),
    role: GrantRole,
    status: GrantStatus,
    invitationStatus: InvitationStatus,
    invitedAt: IsoDateTime,
    invitedBy: UserRef.nullable(),
    activatedAt: IsoDateTime.nullable(),
  })
  .meta({ id: "AccessGrant" });
export const AccessGrantListQuery = PaginationQuery.extend({ jobId: Uuid.optional(), status: GrantStatus.optional() });
export const AccessGrantPage = page(AccessGrant, "AccessGrantPage");
export const CreateAccessGrantRequest = z
  .strictObject({
    email: z
      .string()
      .trim()
      .toLowerCase()
      .max(254)
      .pipe(z.email("Enter a valid email address, e.g. name@example.com.")),
    displayName: ShortText(120).nullable().optional(),
    role: GrantRole,
    jobId: Uuid,
  })
  .meta({ id: "CreateAccessGrantRequest" });

// ---------------------------------------------------------------- audit
export const AuditEvent = z
  .object({
    id: z.string().meta({ description: "Monotonic id (bigint as string)" }),
    occurredAt: IsoDateTime,
    actor: UserRef.nullable(),
    actorType: z.enum(["user", "system"]),
    action: z.string().meta({ example: "checkpoint.status_changed" }),
    jobId: Uuid.nullable(),
    jobNumber: z
      .string()
      .nullable()
      .meta({ description: "Number of the job (also an archived one); null when the event has no job" }),
    entityType: z.string(),
    entityId: z.string().nullable(),
    requestId: z.string().nullable(),
    changes: z.record(z.string(), z.object({ from: z.unknown(), to: z.unknown() })).nullable(),
  })
  .meta({ id: "AuditEvent" });
export const AuditEventListQuery = PaginationQuery.extend({
  jobId: Uuid.optional(),
  actorId: Uuid.optional(),
  action: z.string().max(80).optional(),
  from: IsoDate.optional().meta({ description: "First Perth business date, inclusive" }),
  to: IsoDate.optional().meta({ description: "Last Perth business date, inclusive" }),
}).refine((q) => q.from === undefined || q.to === undefined || q.from <= q.to, {
  message: "from must not be after to",
  path: ["to"],
});
export const AuditEventPage = page(AuditEvent, "AuditEventPage");

// ---------------------------------------------------------------- Teams (ADR-0015, PRODUCT_SPEC §5.10 and §9.3)
export const FeeProposalPolicy = z.enum(["exclude", "restricted"]).meta({
  id: "FeeProposalPolicy",
  description:
    "exclude: fee proposal (1.0) files are never copied; restricted: copied only to the private Fee Proposals channel",
});
/** A pasted "Get link to channel" URL; the API validates host, path, team and tenant (never fetches it). */
export const ChannelLink = z.string().trim().min(1).max(2000).meta({
  description: "A Teams channel link from 'Get link to channel'",
  example: "https://teams.microsoft.com/l/channel/19%3Aabc%40thread.tacv2/General?groupId=…&tenantId=…",
});
const SiteUrl = z
  .url()
  .max(500)
  .refine((u) => u.startsWith("https://"), { message: "Must be an https URL" })
  .meta({ description: "A SharePoint site URL, e.g. https://contoso.sharepoint.com/sites/TeamSurvey" });

export const TeamsSettings = z
  .object({
    teamId: Uuid.nullable().meta({ description: "The Microsoft 365 group id of the team" }),
    teamSiteUrl: z.string().nullable(),
    teamName: z
      .string()
      .nullable()
      .meta({ description: "Display only; filled by Test connection when Graph allows it" }),
    feeChannelId: z.string().nullable(),
    feeChannelLink: z
      .string()
      .nullable()
      .meta({ description: "Rebuilt link of the Fee Proposals channel (for the form)" }),
    feeSiteUrl: z.string().nullable(),
    rootFolder: z.string(),
    feeProposalPolicy: FeeProposalPolicy,
    syncEnabled: z.boolean(),
    inboundSyncEnabled: z.boolean(),
    createChannelsEnabled: z.boolean(),
    inboundPollSeconds: z.number().int().min(60),
    updatedBy: UserRef.nullable(),
    updatedAt: IsoDateTime,
    version: Version,
    lastCheck: z
      .object({ operationId: Uuid, status: OperationStatus, startedAt: IsoDateTime })
      .nullable()
      .meta({ description: "The newest Test connection run; follow it with getOperation" }),
  })
  .meta({ id: "TeamsSettings" });
export type TeamsSettings = z.infer<typeof TeamsSettings>;

export const UpdateTeamsSettingsRequest = z
  .strictObject({
    teamId: Uuid.nullable(),
    teamSiteUrl: SiteUrl.nullable(),
    feeChannelLink: ChannelLink.nullable().meta({ description: "Link of the private Fee Proposals channel, or null" }),
    feeSiteUrl: SiteUrl.nullable(),
    rootFolder: ShortText(100).default("102. Subdivision Tracker"),
    feeProposalPolicy: FeeProposalPolicy,
    syncEnabled: z.boolean(),
    inboundSyncEnabled: z.boolean(),
    createChannelsEnabled: z.boolean(),
    inboundPollSeconds: z.number().int().min(60).max(86_400),
  })
  .refine((v) => !v.inboundSyncEnabled || v.syncEnabled, {
    message: "Turn on Copy files to Teams first.",
    path: ["inboundSyncEnabled"],
  })
  .refine((v) => !v.createChannelsEnabled || v.inboundSyncEnabled, {
    message: "Turn on Bring files added in Teams into the tracker first.",
    path: ["createChannelsEnabled"],
  })
  .refine((v) => !v.syncEnabled || (v.teamId !== null && v.teamSiteUrl !== null), {
    message: "Enter the team id and team site URL before turning on copying.",
    path: ["syncEnabled"],
  })
  .refine((v) => v.feeProposalPolicy !== "restricted" || (v.feeChannelLink !== null && v.feeSiteUrl !== null), {
    message: "Enter the Fee Proposals channel link and site URL first.",
    path: ["feeProposalPolicy"],
  })
  .meta({ id: "UpdateTeamsSettingsRequest" });
export type UpdateTeamsSettingsRequest = z.infer<typeof UpdateTeamsSettingsRequest>;

export const TeamsCheckStarted = z
  .object({ operationId: Uuid })
  .meta({ id: "TeamsCheckStarted", description: "Follow with getOperation; its result is a TeamsCheckResult" });

export const TeamsLinkStatus = z.enum(["provisioning", "ready", "error"]).meta({ id: "TeamsLinkStatus" });
export const TeamsLinkState = z.enum(["sync_off", "not_linked", "not_created", "provisioning", "ready", "error"]).meta({
  id: "TeamsLinkState",
  description:
    "sync_off: Admin → Teams has copying switched off; not_linked: no channel yet; not_created: the app tried to create the channel and could not (errorCode says why); the rest follow the link",
});
export const TeamsLink = z
  .object({
    jobId: Uuid,
    state: TeamsLinkState,
    channelName: z.string().nullable(),
    teamsUrl: z.string().nullable().meta({ description: "Rebuilt teams.microsoft.com link (Open in Teams)" }),
    sharePointUrl: z.string().nullable(),
    linkedBy: UserRef.nullable(),
    linkedAt: IsoDateTime.nullable(),
    lastPushAt: IsoDateTime.nullable(),
    counts: z.object({
      pushed: z.number().int().nonnegative(),
      pending: z.number().int().nonnegative(),
      failed: z.number().int().nonnegative(),
      excluded: z.number().int().nonnegative(),
      unfiled: z
        .number()
        .int()
        .nonnegative()
        .default(0)
        .meta({ description: "Items added in Teams waiting to be filed" }),
    }),
    errorCode: z.string().nullable(),
    operationId: Uuid.nullable().meta({ description: "The provisioning task to follow while state is provisioning" }),
    lastPollAt: IsoDateTime.nullable()
      .default(null)
      .meta({ description: "When files added in Teams were last checked" }),
    inboundSyncEnabled: z.boolean().default(false),
    feeProposalPolicy: FeeProposalPolicy,
    feeProposalFolderUrl: z.string().nullable().meta({
      description: "The job's subfolder in the Fee Proposals channel; only for viewers with fee_proposal.view",
    }),
    canLink: z.boolean().meta({ description: "Whether the current user may link, relink or unlink (teams.link)" }),
    createEnabled: z
      .boolean()
      .default(false)
      .meta({ description: "Create channels for new jobs is on (phase 3): the panel may offer CREATE CHANNEL" }),
    version: Version.nullable(),
  })
  .meta({ id: "TeamsLink" });
export type TeamsLink = z.infer<typeof TeamsLink>;

export const LinkTeamsChannelRequest = z
  .strictObject({ channelLink: ChannelLink })
  .meta({ id: "LinkTeamsChannelRequest" });

/** An item added in Teams that the app could not place by itself (PRODUCT_SPEC §5.10 Unfiled list). */
export const TeamsUnfiledItem = z
  .object({
    itemId: z.string().meta({ description: "The Graph drive item id" }),
    name: z.string(),
    path: z.string().meta({ description: "Folder path under the root folder, '' at the root" }),
    sizeBytes: z.number().int().nonnegative().nullable(),
    addedBy: z.string().nullable().meta({ description: "Display name of whoever last modified it in Teams" }),
    modifiedAt: IsoDateTime.nullable(),
    seenAt: IsoDateTime,
    /** Set when the item cannot be imported at all; the FILE button is then not offered. */
    problem: z.enum(["too_large", "kind_not_accepted", "malware"]).nullable(),
  })
  .meta({ id: "TeamsUnfiledItem" });
export type TeamsUnfiledItem = z.infer<typeof TeamsUnfiledItem>;
export const TeamsUnfiledList = z
  .object({ items: z.array(TeamsUnfiledItem), uploadMaxBytes: z.number().int().positive() })
  .meta({ id: "TeamsUnfiledList" });

export const FileTeamsUnfiledRequest = z
  .strictObject({
    checkpointKey: CheckpointKey.optional(),
    slot: z.string().min(1).max(40).optional(),
    conditionId: Uuid.optional(),
  })
  .refine((v) => (v.conditionId ? !v.checkpointKey && !v.slot : Boolean(v.checkpointKey && v.slot)), {
    message: "Send either checkpointKey + slot, or conditionId",
  })
  .meta({ id: "FileTeamsUnfiledRequest" });
export const TeamsUnfiledParams = z.strictObject({ jobId: Uuid, itemId: z.string().min(1).max(200) });

/** A channel of the configured team from the worker's cache (the link dialog's picker, phase 3). */
export const TeamsChannelOption = z
  .object({ channelId: z.string(), displayName: z.string() })
  .meta({ id: "TeamsChannelOption" });
export const TeamsChannelList = z
  .object({
    channels: z.array(TeamsChannelOption).meta({ description: "Standard channels only, by name" }),
    cachedAt: IsoDateTime.nullable().meta({ description: "When the worker last listed them; null when never" }),
    channelName: z
      .string()
      .nullable()
      .meta({ description: "The name the app would give a new job's channel, when job details are given" }),
    nameTaken: z.boolean().meta({ description: "That name is already a channel of the team (case-insensitive)" }),
    createEnabled: z.boolean().meta({ description: "Create channels for new jobs is on under Admin → Teams" }),
    teamId: Uuid.nullable().meta({ description: "The configured team, for building a link from a picked channel" }),
    tenantId: Uuid,
  })
  .meta({ id: "TeamsChannelList" });
export const TeamsChannelListQuery = z.strictObject({
  jobNumber: z.string().max(32).optional(),
  address: z.string().max(200).optional(),
  clientName: z.string().max(200).optional(),
});

// ---------------------------------------------------------------- path params
export const JobIdParams = z.strictObject({ jobId: Uuid });
export const JobCheckpointParams = z.strictObject({ jobId: Uuid, checkpointKey: CheckpointKey });
export const JobConditionParams = z.strictObject({ jobId: Uuid, conditionId: Uuid });
export const JobNoteParams = z.strictObject({ jobId: Uuid, noteId: Uuid });
export const FileIdParams = z.strictObject({ fileId: Uuid });
export const OperationIdParams = z.strictObject({ operationId: Uuid });
export const GrantIdParams = z.strictObject({ grantId: Uuid });
export const UserIdParams = z.strictObject({ userId: Uuid });

export const AuthLoginQuery = z.strictObject({
  returnTo: z
    .string()
    .max(512)
    .regex(/^\/(?!\/)[^\s\\]*$/, "Must be a same-origin path")
    .optional()
    .meta({ description: "Same-origin path to return to after sign-in (open-redirect safe)" }),
});
export const AuthCallbackQuery = z.object({
  code: z.string().max(4096).optional(),
  state: z.string().max(512).optional(),
  error: z.string().max(256).optional(),
  error_description: z.string().max(2048).optional(),
});

export const HealthResponse = z
  .object({ status: z.enum(["ok", "degraded"]), checks: z.record(z.string(), z.enum(["ok", "fail"])) })
  .meta({ id: "HealthResponse" });
