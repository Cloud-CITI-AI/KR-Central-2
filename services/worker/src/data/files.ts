/** File and email queries of the scan handler (BE-7: Kysely only). */
import { enqueueOperation, recordAudit, type Db, type FileRow, type ScanStatusValue } from "@kr/db";
import { sql, type Transaction } from "kysely";
import type { Database } from "@kr/db";

export type ScanFile = Pick<
  FileRow,
  "id" | "job_id" | "storage_key" | "kind" | "scan_status" | "scan_attempts" | "deleted_at" | "purged_at"
>;

export function findScanFile(db: Db, id: string): Promise<ScanFile | undefined> {
  return db
    .selectFrom("files")
    .select(["id", "job_id", "storage_key", "kind", "scan_status", "scan_attempts", "deleted_at", "purged_at"])
    .where("id", "=", id)
    .executeTakeFirst();
}

export interface ScanResult {
  readonly status: Extract<ScanStatusValue, "clean" | "infected" | "skipped" | "error">;
  readonly detail: string | null;
  /** True for a failed scan: counts toward SCAN_ERROR_MAX_RETRIES. */
  readonly failed?: boolean;
}

/** Records the verdict. Returns the new scan_attempts. */
export async function saveScanResult(trx: Transaction<Database>, fileId: string, result: ScanResult): Promise<number> {
  const row = await trx
    .updateTable("files")
    .set({
      scan_status: result.status,
      scan_detail: result.detail,
      scanned_at: sql<Date>`now()`,
      ...(result.failed ? { scan_attempts: sql<number>`scan_attempts + 1` } : {}),
    })
    .where("id", "=", fileId)
    .returning("scan_attempts")
    .executeTakeFirstOrThrow();
  return row.scan_attempts;
}

/** The system audit row of an infected upload (no file name, no content). */
export function auditInfected(trx: Transaction<Database>, file: ScanFile, signature: string): Promise<void> {
  return recordAudit(trx, {
    actorUserId: null,
    action: "file.infected",
    entityType: "file",
    entityId: file.id,
    jobId: file.job_id,
    changes: { scanStatus: { from: file.scan_status, to: "infected" }, signature: { from: null, to: signature } },
  });
}

/**
 * After a file passes the scan: an uploaded email (not a pasted one, which is already parsed) gets its email.parse, unless
 * one was queued, ran or is running (a re-run after a lease expiry must not queue a second).
 */
export async function queueEmailParse(trx: Transaction<Database>, file: ScanFile): Promise<boolean> {
  if (file.kind !== "email") return false;
  const email = await trx
    .selectFrom("email_messages")
    .select(["parse_status", "is_pasted"])
    .where("file_id", "=", file.id)
    .executeTakeFirst();
  if (email?.parse_status !== "pending" || email.is_pasted) return false;
  const existing = await trx
    .selectFrom("operations")
    .select("id")
    .where("type", "=", "email.parse")
    .where(sql<string>`payload->>'fileId'`, "=", file.id)
    .where("status", "<>", "failed")
    .executeTakeFirst();
  if (existing) return false;
  await enqueueOperation(trx, {
    jobId: file.job_id,
    type: "email.parse",
    payload: { fileId: file.id },
    createdBy: null,
  });
  return true;
}

export type DocumentFile = Pick<
  FileRow,
  "id" | "job_id" | "storage_key" | "kind" | "checkpoint_key" | "slot" | "scan_status" | "deleted_at" | "purged_at"
>;

/** A file as the document readers need it: where it is stored, which slot it sits in, whether it may be read. */
export function findDocument(db: Db, id: string): Promise<DocumentFile | undefined> {
  return db
    .selectFrom("files")
    .select(["id", "job_id", "storage_key", "kind", "checkpoint_key", "slot", "scan_status", "deleted_at", "purged_at"])
    .where("id", "=", id)
    .executeTakeFirst();
}
