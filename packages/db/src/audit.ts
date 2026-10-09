/**
 * Append-only audit writer (DATA_MODEL §6). Call inside the same transaction as the change it records.
 * `changes` holds only changed fields as {from, to}; never file contents, tokens or secrets.
 */
import type { Kysely, Transaction } from "kysely";
import type { Database } from "./schema.js";

type Executor = Kysely<Database> | Transaction<Database>;

export type AuditChanges = Readonly<Record<string, { readonly from: unknown; readonly to: unknown }>>;

export interface AuditEventInput {
  /** null for system actions (worker, sweeps). */
  readonly actorUserId: string | null;
  /** "entity.verb", lower snake case, e.g. "checkpoint.status_changed". */
  readonly action: string;
  readonly entityType: string;
  readonly entityId?: string | null;
  readonly jobId?: string | null;
  readonly requestId?: string | null;
  readonly changes?: AuditChanges | null;
}

const ACTION = /^[a-z_]+\.[a-z_.]+$/;

export async function recordAudit(db: Executor, e: AuditEventInput): Promise<void> {
  if (!ACTION.test(e.action)) throw new RangeError(`Invalid audit action: ${e.action}`);
  await db
    .insertInto("audit_events")
    .values({
      actor_user_id: e.actorUserId,
      actor_type: e.actorUserId ? "user" : "system",
      action: e.action,
      entity_type: e.entityType,
      entity_id: e.entityId ?? null,
      job_id: e.jobId ?? null,
      request_id: e.requestId ?? null,
      changes: e.changes ? JSON.stringify(e.changes) : null,
    })
    .execute();
}

/** Build a changes object containing only fields whose value differs. */
export function diffChanges(
  before: Readonly<Record<string, unknown>>,
  after: Readonly<Record<string, unknown>>,
): AuditChanges | null {
  const out: Record<string, { from: unknown; to: unknown }> = {};
  for (const [k, to] of Object.entries(after)) {
    const from = before[k];
    if (to !== undefined && JSON.stringify(from) !== JSON.stringify(to)) out[k] = { from, to };
  }
  return Object.keys(out).length ? out : null;
}
