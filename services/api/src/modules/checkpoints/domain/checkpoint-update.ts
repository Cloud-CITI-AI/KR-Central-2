/**
 * Checkpoint writes as pure plans (PRODUCT_SPEC §5.4, §5.5, R13, R14): what to store and what to audit for a status /
 * responsibility / KR note edit, a client decision and the paid button. The routes load the row, apply the plan in one
 * transaction and write the audit rows it lists.
 *
 * Audit rules: only changed fields, {from, to}. Free text (the KR note, a decision comment) is never copied into the
 * append-only audit trail; its length is recorded instead.
 */
import type { JobCapability, UpdateCheckpointRequest, RecordDecisionRequest } from "@kr/contracts";
import type { AuditChanges, CheckpointStateRow } from "@kr/db";
import { getCheckpoint, hasPanel } from "@kr/workflow";
import type { z } from "zod";

type UpdateBody = z.output<typeof UpdateCheckpointRequest>;
type DecisionBody = z.output<typeof RecordDecisionRequest>;

export type StateColumns = Partial<
  Pick<
    CheckpointStateRow,
    | "status"
    | "responsibility"
    | "kr_note"
    | "decision"
    | "decision_comment"
    | "decided_at"
    | "decided_by"
    | "paid_at"
    | "paid_by"
  >
>;

export interface PlannedAudit {
  readonly action: string;
  readonly changes: AuditChanges;
}

export interface CheckpointPlan {
  readonly set: StateColumns;
  readonly audits: readonly PlannedAudit[];
  /** True when nothing would change: no version bump, no audit. */
  readonly isNoOp: boolean;
}

const plan = (set: StateColumns, audits: PlannedAudit[]): CheckpointPlan => ({
  set,
  audits,
  isNoOp: audits.length === 0,
});

/** The capability each edited field needs (PRODUCT_SPEC §2.1). */
export function capabilitiesForUpdate(body: UpdateBody): JobCapability[] {
  const needed: JobCapability[] = [];
  if (body.status !== undefined) needed.push("checkpoint.status.edit");
  if (body.responsibility !== undefined) needed.push("checkpoint.responsibility.edit");
  if (body.krNote !== undefined) needed.push("checkpoint.kr_note.edit");
  return needed;
}

export const hasNoteBox = (key: string): boolean => hasPanel(getCheckpoint(key), "kr_note");
export const hasApprovalPanel = (key: string): boolean => hasPanel(getCheckpoint(key), "approval");
export const hasPaidPanel = (key: string): boolean => hasPanel(getCheckpoint(key), "paid");

export function planCheckpointUpdate(
  current: Pick<CheckpointStateRow, "status" | "responsibility" | "kr_note">,
  body: UpdateBody,
): CheckpointPlan {
  const set: StateColumns = {};
  const audits: PlannedAudit[] = [];
  if (body.status !== undefined && body.status !== current.status) {
    set.status = body.status;
    audits.push({
      action: "checkpoint.status_changed",
      changes: { status: { from: current.status, to: body.status } },
    });
  }
  if (body.responsibility !== undefined && body.responsibility !== current.responsibility) {
    set.responsibility = body.responsibility;
    audits.push({
      action: "checkpoint.responsibility_changed",
      changes: { responsibility: { from: current.responsibility, to: body.responsibility } },
    });
  }
  if (body.krNote !== undefined && body.krNote !== current.kr_note) {
    set.kr_note = body.krNote;
    audits.push({
      action: "checkpoint.kr_note_changed",
      changes: { krNoteLength: { from: current.kr_note.length, to: body.krNote.length } },
    });
  }
  return plan(set, audits);
}

/** The decision does NOT change the status (§5.5); recording the same decision again keeps the first record. */
export function planDecision(
  current: Pick<CheckpointStateRow, "decision" | "decision_comment">,
  body: DecisionBody,
  userId: string,
  now: Date,
): CheckpointPlan {
  if (current.decision === body.value && current.decision_comment === body.comment) return plan({}, []);
  return plan({ decision: body.value, decision_comment: body.comment, decided_at: now, decided_by: userId }, [
    {
      action: "checkpoint.decision_recorded",
      changes: {
        decision: { from: current.decision, to: body.value },
        commentLength: { from: current.decision_comment.length, to: body.comment.length },
      },
    },
  ]);
}

/** R13: the client response button records the time and completes the checkpoint; pressing it twice changes nothing. */
export function planPaid(
  current: Pick<CheckpointStateRow, "status" | "paid_at">,
  userId: string,
  now: Date,
): CheckpointPlan {
  if (current.paid_at) return plan({}, []);
  return plan({ paid_at: now, paid_by: userId, status: "completed" }, [
    {
      action: "checkpoint.paid_recorded",
      changes: { paidAt: { from: null, to: now.toISOString() }, status: { from: current.status, to: "completed" } },
    },
  ]);
}

/** R13: Undo clears the paid record and sets Not completed; undoing an unpaid checkpoint changes nothing. */
export function planUndoPaid(current: Pick<CheckpointStateRow, "status" | "paid_at">): CheckpointPlan {
  if (!current.paid_at) return plan({}, []);
  return plan({ paid_at: null, paid_by: null, status: "not_completed" }, [
    {
      action: "checkpoint.paid_undone",
      changes: {
        paidAt: { from: current.paid_at.toISOString(), to: null },
        status: { from: current.status, to: "not_completed" },
      },
    },
  ]);
}
