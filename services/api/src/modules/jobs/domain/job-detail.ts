/**
 * The tracker view of one job (contract JobDetail) and of one checkpoint (CheckpointState), built from loaded rows.
 * Pure. Every rule value comes from @kr/workflow; the only thing decided here is what THIS viewer may see: the fee
 * proposal's panel content (note, decision, paid, files) is replaced by its restricted form without `fee_proposal.view`
 * (PRODUCT_SPEC §5.4, developer note 2).
 */
import type { CheckpointState, GrantRole, JobCapability, JobDetail } from "@kr/contracts";
import type { CheckpointStateRow, ConditionRow, EmailMessageRow, FileRow, JobRow, UserRow } from "@kr/db";
import {
  CHECKPOINTS,
  STAGES,
  effectiveState,
  getCheckpoint,
  summariseJob,
  summariseStage,
  type JobRuleInput,
} from "@kr/workflow";
import { toCheckpointState, toCondition, toFileMeta } from "../../_shared/index.js";
import { toSubdivisionType } from "./job-card.js";
import { canViewFeeProposal, isRestrictedFor, toRuleInput } from "./rule-input.js";

type Named = Pick<UserRow, "id" | "display_name">;

/** Everything loaded for one job (data/job-parts.ts). `files` are the non-deleted ones the viewer may be shown. */
export interface JobParts {
  readonly job: JobRow;
  /** All 46 rows. */
  readonly states: readonly CheckpointStateRow[];
  /** Current (non-superseded) conditions, by number. */
  readonly conditions: readonly ConditionRow[];
  readonly files: readonly FileRow[];
  readonly emails: readonly EmailMessageRow[];
  readonly users: readonly Named[];
  /** Original names of the conformed and decision-letter files, kept even after the file is removed. */
  readonly fileNames: ReadonlyMap<string, string>;
}

export interface JobViewer {
  readonly id: string;
  readonly capabilities: readonly JobCapability[];
  readonly grantRole: GrantRole | null;
}

interface View {
  readonly input: JobRuleInput;
  readonly canSeeFee: boolean;
  readonly users: ReadonlyMap<string, Named>;
  readonly emails: ReadonlyMap<string, EmailMessageRow>;
  readonly visibleFiles: readonly FileRow[];
}

function makeView(parts: JobParts, viewer: JobViewer): View {
  const canSeeFee = canViewFeeProposal(viewer.capabilities);
  return {
    input: toRuleInput(parts.job, parts.states, parts.conditions, canSeeFee),
    canSeeFee,
    users: new Map(parts.users.map((u) => [u.id, u])),
    emails: new Map(parts.emails.map((e) => [e.file_id, e])),
    visibleFiles: parts.files.filter((f) => f.checkpoint_key === null || !isRestrictedFor(f.checkpoint_key, canSeeFee)),
  };
}

function fileMeta(view: View, viewer: JobViewer, file: FileRow) {
  const own = file.uploaded_by !== null && file.uploaded_by === viewer.id;
  return toFileMeta(file, {
    uploader: file.uploaded_by ? (view.users.get(file.uploaded_by) ?? null) : null,
    canDelete:
      viewer.capabilities.includes("files.delete.any") || (own && viewer.capabilities.includes("files.delete.own")),
    email: view.emails.get(file.id) ?? null,
  });
}

function checkpointOf(parts: JobParts, view: View, viewer: JobViewer, row: CheckpointStateRow): CheckpointState {
  const effective = effectiveState(row.checkpoint_key, view.input);
  return toCheckpointState(row, {
    effective: { status: effective.status, excludedByConditions: effective.excludedByConditions },
    files: view.visibleFiles
      .filter((f) => f.checkpoint_key === row.checkpoint_key)
      .map((f) => fileMeta(view, viewer, f)),
    isRestricted: isRestrictedFor(row.checkpoint_key, view.canSeeFee),
    paidBy: row.paid_by ? (view.users.get(row.paid_by) ?? null) : null,
    decidedBy: row.decided_by ? (view.users.get(row.decided_by) ?? null) : null,
  });
}

function stateRow(parts: JobParts, key: string): CheckpointStateRow {
  const row = parts.states.find((s) => s.checkpoint_key === key);
  // createJob inserts all 46 rows in the job's own transaction; a missing one is data corruption, not a client error.
  if (!row) throw new RangeError(`Job ${parts.job.id} has no state row for checkpoint ${key}`);
  return row;
}

/** One checkpoint as the viewer sees it (the body of updateCheckpoint, recordDecision, markPaid and undoPaid). */
export function buildCheckpointState(parts: JobParts, viewer: JobViewer, key: string): CheckpointState {
  getCheckpoint(key);
  return checkpointOf(parts, makeView(parts, viewer), viewer, stateRow(parts, key));
}

export function buildJobDetail(parts: JobParts, viewer: JobViewer, now: Date): JobDetail {
  const { job } = parts;
  const view = makeView(parts, viewer);
  const summary = summariseJob(view.input, now);
  const conditions = parts.conditions.map((c) =>
    toCondition(
      c,
      view.visibleFiles.filter((f) => f.condition_id === c.id).map((f) => fileMeta(view, viewer, f)),
    ),
  );
  const nameOf = (id: string | null) => (id ? (parts.fileNames.get(id) ?? null) : null);
  return {
    id: job.id,
    jobNumber: job.job_number,
    address: job.address,
    clientName: job.client_name,
    subdivisionType: toSubdivisionType(job.subdivision_type),
    approvalDate: job.approval_date,
    approvalExpiry: job.approval_expiry,
    conformedDate: job.conformed_date,
    conformedSource: job.conformed_method
      ? { method: job.conformed_method, fileName: nameOf(job.conformed_file_id), stampText: job.conformed_stamp_text }
      : null,
    outcomeDate: job.outcome_date,
    conditionsSource:
      job.conditions_source_file_id && job.conditions_extracted_at
        ? {
            fileId: job.conditions_source_file_id,
            fileName: nameOf(job.conditions_source_file_id) ?? "",
            extractedAt: job.conditions_extracted_at.toISOString(),
          }
        : null,
    checkpoints: CHECKPOINTS.map((c) => checkpointOf(parts, view, viewer, stateRow(parts, c.key))),
    conditions,
    summary: {
      progress: summary.progress,
      stages: STAGES.map((s) => summariseStage(s, view.input)),
      isComplete: summary.isComplete,
      alerts: [...summary.alerts],
      fileCount: view.visibleFiles.filter((f) => f.scan_status === "clean" || f.scan_status === "skipped").length,
    },
    capabilities: [...viewer.capabilities],
    viewerGrantRole: viewer.grantRole,
    version: job.version,
    createdAt: job.created_at.toISOString(),
    updatedAt: job.updated_at.toISOString(),
  };
}
