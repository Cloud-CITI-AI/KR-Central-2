/** File and email queries of the scan handler (BE-7: Kysely only). */
import { recordAudit, type Db, type FileRow, type ScanStatusValue } from "@kr/db";
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
}

/** Records the verdict. */
export async function saveScanResult(trx: Transaction<Database>, fileId: string, result: ScanResult): Promise<void> {
  await trx
    .updateTable("files")
    .set({
      scan_status: result.status,
      scan_detail: result.detail,
      scanned_at: sql<Date>`now()`,
    })
    .where("id", "=", fileId)
    .execute();
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
