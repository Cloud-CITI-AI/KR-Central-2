/**
 * Pure mappers from database rows to the contract's response types (the single place that converts snake_case rows,
 * bigint strings and Dates to the API shape). No I/O: callers load the related rows (uploader, evidence, files) and pass
 * them in, so modules share one definition of "what a file / condition / checkpoint looks like".
 */
import type {
  AccessGrant,
  AuditEvent,
  CheckpointState,
  Condition,
  EmailMeta,
  FileMeta,
  JobNote,
  UserRef,
} from "@kr/contracts";
import type {
  AccessGrantRow,
  AuditEventRow,
  CheckpointStateRow,
  ConditionRow,
  EmailMessageRow,
  FileRow,
  JobNoteRow,
  UserRow,
} from "@kr/db";
import type { z } from "zod";

type Named = Pick<UserRow, "id" | "display_name">;
type Out<T> = T extends z.ZodType ? z.output<T> : T;
export type EmailMetaOut = Out<typeof EmailMeta>;

const iso = (d: Date): string => d.toISOString();
const isoOrNull = (d: Date | null): string | null => (d ? d.toISOString() : null);

/** Minimal user reference: id and display name only (no email, data minimisation). */
export function toUserRef(user: Named | null): UserRef | null {
  return user ? { id: user.id, displayName: user.display_name } : null;
}

/** Content is readable only once the scan is clean or skipped (PRODUCT_SPEC 5.5); the parsed body follows the same rule. */
const isReadable = (scan: FileRow["scan_status"]): boolean => scan === "clean" || scan === "skipped";

export function toEmailMeta(row: EmailMessageRow, scan: FileRow["scan_status"]): EmailMetaOut {
  return {
    parseStatus: row.parse_status,
    subject: row.subject,
    from: row.from_text,
    to: row.to_text,
    cc: row.cc_text,
    sentAt: isoOrNull(row.sent_at),
    isPasted: row.is_pasted,
    bodyText: isReadable(scan) ? row.body_text : null,
  };
}

export interface FileMetaContext {
  readonly uploader: Named | null;
  readonly canDelete: boolean;
  readonly email: EmailMessageRow | null;
}

export function toFileMeta(file: FileRow, ctx: FileMetaContext): FileMeta {
  return {
    id: file.id,
    jobId: file.job_id,
    checkpointKey: file.checkpoint_key,
    conditionId: file.condition_id,
    slot: file.slot,
    name: file.original_name,
    kind: file.kind,
    contentType: file.content_type,
    sizeBytes: Number(file.size_bytes),
    scanStatus: file.scan_status,
    scanRetriesExhausted: file.scan_retries_exhausted,
    uploadedAt: iso(file.uploaded_at),
    uploadedBy: toUserRef(ctx.uploader),
    canDelete: ctx.canDelete,
    email: ctx.email ? toEmailMeta(ctx.email, file.scan_status) : null,
  };
}

export function toCondition(row: ConditionRow, evidence: readonly FileMeta[]): Condition {
  return {
    id: row.id,
    number: row.condition_number,
    text: row.text,
    agency: row.agency as Condition["agency"],
    agencyGuessed: row.agency_guessed,
    isCleared: row.is_cleared,
    responsibility: row.responsibility,
    krComment: row.kr_comment,
    clientComment: row.client_comment,
    evidence: [...evidence],
    version: row.version,
    updatedAt: iso(row.updated_at),
  };
}

export interface CheckpointContext {
  /** From @kr/workflow `effectiveState` (agency exclusion applied). */
  readonly effective: { readonly status: CheckpointState["status"]; readonly excludedByConditions: boolean };
  readonly files: readonly FileMeta[];
  /** Fee proposal for a viewer without `fee_proposal.view`: only number, status and responsibility survive. */
  readonly isRestricted: boolean;
  readonly paidBy: Named | null;
  readonly decidedBy: Named | null;
}

export function toCheckpointState(row: CheckpointStateRow, ctx: CheckpointContext): CheckpointState {
  const hidden = ctx.isRestricted;
  return {
    key: row.checkpoint_key,
    status: ctx.effective.status,
    storedStatus: row.status,
    excludedByConditions: ctx.effective.excludedByConditions,
    responsibility: row.responsibility,
    krNote: hidden ? "" : row.kr_note,
    paid: hidden || !row.paid_at ? null : { at: iso(row.paid_at), by: toUserRef(ctx.paidBy) },
    decision:
      hidden || !row.decision || !row.decided_at
        ? null
        : { value: row.decision, comment: row.decision_comment, at: iso(row.decided_at), by: toUserRef(ctx.decidedBy) },
    files: hidden ? [] : [...ctx.files],
    isRestricted: hidden,
    version: row.version,
    updatedAt: iso(row.updated_at),
  };
}

export interface NoteContext {
  readonly author: Named | null;
  readonly viewerId: string;
  /** Capability `notes.delete.any`. */
  readonly canDeleteAny: boolean;
}

export function toJobNote(row: JobNoteRow, ctx: NoteContext): Out<typeof JobNote> {
  const isOwn = row.author_id !== null && row.author_id === ctx.viewerId;
  return {
    id: row.id,
    jobId: row.job_id,
    body: row.body,
    audience: row.audience,
    author: toUserRef(ctx.author),
    isOwn,
    canDelete: ctx.canDeleteAny || isOwn,
    createdAt: iso(row.created_at),
  };
}

export interface GrantContext {
  readonly jobNumber: string;
  readonly invitedBy: Named | null;
}

export function toAccessGrant(row: AccessGrantRow, ctx: GrantContext): Out<typeof AccessGrant> {
  return {
    id: row.id,
    jobId: row.job_id,
    jobNumber: ctx.jobNumber,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    status: row.status,
    invitationStatus: row.invitation_status,
    invitedAt: iso(row.invited_at),
    invitedBy: toUserRef(ctx.invitedBy),
    activatedAt: isoOrNull(row.activated_at),
  };
}

export function toAuditEvent(
  row: AuditEventRow,
  actor: Named | null,
  jobNumber: string | null,
): Out<typeof AuditEvent> {
  return {
    id: row.id,
    occurredAt: iso(row.occurred_at),
    actor: toUserRef(actor),
    actorType: row.actor_type,
    action: row.action,
    jobId: row.job_id,
    jobNumber,
    entityType: row.entity_type,
    entityId: row.entity_id,
    requestId: row.request_id,
    changes: row.changes as Out<typeof AuditEvent>["changes"],
  };
}
