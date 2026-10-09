/**
 * A condition edit as a pure plan (PRODUCT_SPEC §2.1, §5.6): the capability each field needs, what to store and what to
 * audit. The route loads the row, applies the plan in one transaction and writes the audit event.
 *
 * Audit rules: only changed fields, {from, to}. Free text (KR and client comments) is never copied into the append-only
 * audit trail; its length is recorded instead.
 */
import type { JobCapability, UpdateConditionRequest } from "@kr/contracts";
import type { AuditChanges, ConditionRow } from "@kr/db";
import type { z } from "zod";

type Body = z.output<typeof UpdateConditionRequest>;

export type ConditionColumns = Partial<
  Pick<
    ConditionRow,
    | "is_cleared"
    | "cleared_at"
    | "cleared_by"
    | "responsibility"
    | "agency"
    | "agency_guessed"
    | "kr_comment"
    | "client_comment"
  >
>;

export interface ConditionPlan {
  readonly set: ConditionColumns;
  /** The audit `changes`, or null when nothing would change: no version bump, no audit. */
  readonly changes: AuditChanges | null;
}

/**
 * Staff change the tick, responsibility, agency and KR comment; the client comment is open to everyone with access
 * (clients and architects may do nothing else). A request that mixes both needs both capabilities, never a partial save.
 */
export function capabilitiesForConditionUpdate(body: Body): JobCapability[] {
  const needed: JobCapability[] = [];
  if (body.clientComment !== undefined) needed.push("conditions.client_comment.edit");
  const { clientComment: _clientComment, ...staffFields } = body;
  if (Object.values(staffFields).some((v) => v !== undefined)) needed.push("conditions.edit");
  return needed;
}

type Current = Pick<
  ConditionRow,
  "is_cleared" | "responsibility" | "agency" | "agency_guessed" | "kr_comment" | "client_comment"
>;

export function planConditionUpdate(current: Current, body: Body, userId: string, now: Date): ConditionPlan {
  const set: ConditionColumns = {};
  const changes: Record<string, { from: unknown; to: unknown }> = {};

  if (body.isCleared !== undefined && body.isCleared !== current.is_cleared) {
    set.is_cleared = body.isCleared;
    set.cleared_at = body.isCleared ? now : null;
    set.cleared_by = body.isCleared ? userId : null;
    changes.isCleared = { from: current.is_cleared, to: body.isCleared };
  }
  if (body.responsibility !== undefined && body.responsibility !== current.responsibility) {
    set.responsibility = body.responsibility;
    changes.responsibility = { from: current.responsibility, to: body.responsibility };
  }
  if (body.agency !== undefined && body.agency !== current.agency) {
    set.agency = body.agency;
    changes.agency = { from: current.agency, to: body.agency };
  }
  // Choosing an agency, or confirming the guess as it stands, ends the "agency guessed" state.
  if ((body.agency !== undefined || body.agencyConfirmed === true) && current.agency_guessed) {
    set.agency_guessed = false;
    changes.agencyGuessed = { from: true, to: false };
  }
  if (body.krComment !== undefined && body.krComment !== current.kr_comment) {
    set.kr_comment = body.krComment;
    changes.krCommentLength = { from: current.kr_comment.length, to: body.krComment.length };
  }
  if (body.clientComment !== undefined && body.clientComment !== current.client_comment) {
    set.client_comment = body.clientComment;
    changes.clientCommentLength = { from: current.client_comment.length, to: body.clientComment.length };
  }
  return { set, changes: Object.keys(changes).length > 0 ? changes : null };
}
