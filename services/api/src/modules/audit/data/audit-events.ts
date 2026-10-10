/** audit_events reads (DATA_MODEL §6): newest first by the identity id. The table is append-only. */
import type { AuditEventRow, Db } from "@kr/db";
import { sql } from "kysely";
import type { OccurredRange } from "../domain/audit-filters.js";
import { prefixPattern } from "../domain/audit-filters.js";

export interface AuditFilters {
  readonly jobId: string | undefined;
  readonly actorId: string | undefined;
  readonly actionPrefix: string | undefined;
  readonly range: OccurredRange | null;
  /** The last id of the previous page. */
  readonly beforeId: string | null;
  readonly limit: number;
}

export interface AuditRow {
  readonly row: AuditEventRow;
  readonly actorName: string | null;
  /** The job's number, joined so the trail shows what the filter takes (also for an archived job). */
  readonly jobNumber: string | null;
}

export async function listAuditRows(db: Db, f: AuditFilters): Promise<AuditRow[]> {
  let q = db
    .selectFrom("audit_events as e")
    .leftJoin("users as u", "u.id", "e.actor_user_id")
    .leftJoin("jobs as j", "j.id", "e.job_id")
    .selectAll("e")
    .select(["u.display_name as actor_name", "j.job_number as job_number"]);
  if (f.jobId) q = q.where("e.job_id", "=", f.jobId);
  if (f.actorId) q = q.where("e.actor_user_id", "=", f.actorId);
  if (f.actionPrefix) q = q.where("e.action", "like", prefixPattern(f.actionPrefix));
  if (f.range?.from) q = q.where("e.occurred_at", ">=", f.range.from);
  if (f.range?.before) q = q.where("e.occurred_at", "<", f.range.before);
  if (f.beforeId !== null) q = q.where(sql<boolean>`e.id < ${f.beforeId}::bigint`);
  const rows = await q
    .orderBy("e.id", "desc")
    .limit(f.limit + 1)
    .execute();
  return rows.map(({ actor_name, job_number, ...row }) => ({ row, actorName: actor_name, jobNumber: job_number }));
}
