/**
 * Audit trail helpers (DATA_MODEL §6): the audit row is written in the SAME transaction as the change it records, with
 * the actor and request id from the request. `changes` holds only changed fields ({from, to}); never file contents,
 * tokens or secrets. Thin wrappers over @kr/db's recordAudit/diffChanges.
 */
import { diffChanges, recordAudit, type AuditEventInput, type Database, type Db } from "@kr/db";
import type { FastifyRequest } from "fastify";
import type { Transaction } from "kysely";

export { diffChanges };

export interface AuditContext {
  /** null for system actions. */
  readonly actorUserId: string | null;
  readonly requestId: string;
}

export function auditContext(request: Pick<FastifyRequest, "id" | "auth">): AuditContext {
  return { actorUserId: request.auth?.user.id ?? null, requestId: request.id };
}

export type AuditEntry = Omit<AuditEventInput, "actorUserId" | "requestId">;

/** Write one audit event inside `trx` (pass the transaction that performs the change). */
export async function audit(trx: Transaction<Database>, ctx: AuditContext, entry: AuditEntry): Promise<void> {
  await recordAudit(trx, { ...entry, actorUserId: ctx.actorUserId, requestId: ctx.requestId });
}

/** Run `fn` in one transaction: it commits when `fn` resolves and rolls back (audit rows included) when it throws. */
export function withTransaction<T>(db: Db, fn: (trx: Transaction<Database>) => Promise<T>): Promise<T> {
  return db.transaction().execute(fn);
}
