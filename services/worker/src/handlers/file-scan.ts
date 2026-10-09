/**
 * file.scan (PRODUCT_SPEC §11, ADR-0011): streams the stored object to clamd and records clean / infected / error on the
 * file. Infected objects are deleted and audited; a scan that gives no verdict is never "clean". Idempotent: a re-run after
 * a lease expiry finds the verdict already recorded and only repeats the steps that follow it.
 */
import { ObjectNotFoundError, type ObjectStorage } from "@kr/storage";
import type { Db } from "@kr/db";
import type { KrMetrics } from "@kr/telemetry";
import { z } from "zod";
import type { WorkerConfig } from "../config.js";
import { ClamdError, type ClamdClient, type ScanVerdict } from "../clients/clamd.js";
import { findScanFile, auditInfected, queueEmailParse, saveScanResult, type ScanFile } from "../data/files.js";
import { judgeScanError, mayRescan, type ScanErrorKind } from "../domain/scan.js";
import { TaskError } from "../errors.js";
import type { Handler, HandlerContext } from "./types.js";

const Payload = z.object({ fileId: z.uuid() });

export interface FileScanDeps {
  readonly db: Db;
  readonly storage: ObjectStorage;
  readonly clamd: ClamdClient;
  readonly config: Pick<WorkerConfig, "MALWARE_SCAN_MODE" | "CLAMAV_TIMEOUT_MS" | "SCAN_ERROR_MAX_RETRIES">;
  readonly metrics: Pick<KrMetrics, "recordFileScan">;
}

function errorKind(error: unknown): ScanErrorKind {
  if (error instanceof ClamdError) return error.code === "aborted" ? "timeout" : error.code;
  return error instanceof ObjectNotFoundError ? "object_missing" : "storage";
}

export function fileScanHandler(deps: FileScanDeps): Handler {
  const { db, storage, clamd, config, metrics } = deps;

  /** Records a passed scan and, for an uploaded email, queues its parse in the same transaction. */
  async function pass(file: ScanFile, status: "clean" | "skipped"): Promise<void> {
    await db.transaction().execute(async (trx) => {
      await saveScanResult(trx, file.id, { status, detail: null });
      await queueEmailParse(trx, file);
    });
  }

  async function infected(file: ScanFile, signature: string, ctx: HandlerContext): Promise<void> {
    await db.transaction().execute(async (trx) => {
      await saveScanResult(trx, file.id, { status: "infected", detail: signature.slice(0, 500) });
      await auditInfected(trx, file, signature);
    });
    metrics.recordFileScan("infected");
    ctx.log.error(
      { event: "malware_detected", fileId: file.id, signature },
      "Malware found in an upload; the object is deleted",
    );
    await storage.delete(file.storage_key);
  }

  async function scanFailed(file: ScanFile, error: unknown, ctx: HandlerContext): Promise<never> {
    const kind = errorKind(error);
    const { detail, final } = judgeScanError(kind, ctx.operation.attempts, ctx.operation.max_attempts);
    if (!final) {
      throw new TaskError(
        "scan_unavailable",
        "The file could not be checked for viruses yet. It will be tried again.",
        {
          retryable: true,
          cause: error,
        },
      );
    }
    const failedScans = await db
      .transaction()
      .execute((trx) => saveScanResult(trx, file.id, { status: "error", detail, failed: true }));
    metrics.recordFileScan("error");
    const event = mayRescan(failedScans, config.SCAN_ERROR_MAX_RETRIES) ? "scan_failed" : "scan_retries_exhausted";
    ctx.log[event === "scan_failed" ? "warn" : "error"](
      { event, fileId: file.id, kind, failedScans },
      "A file could not be scanned",
    );
    throw new TaskError("scan_error", "The file could not be checked for viruses.", { cause: error });
  }

  return {
    timeoutMs: Math.max(120_000, config.CLAMAV_TIMEOUT_MS * 2),
    async run(ctx) {
      const payload = Payload.safeParse(ctx.operation.payload);
      if (!payload.success) throw new TaskError("invalid_payload", "The task was not set up correctly.");
      const file = await findScanFile(db, payload.data.fileId);
      if (file?.job_id !== ctx.operation.job_id || file.deleted_at || file.purged_at) return { scanStatus: "gone" };

      if (file.scan_status === "infected") {
        await storage.delete(file.storage_key);
        return { scanStatus: "infected" };
      }
      if (file.scan_status === "clean" || file.scan_status === "skipped") {
        await db.transaction().execute((trx) => queueEmailParse(trx, file));
        return { scanStatus: file.scan_status };
      }
      if (config.MALWARE_SCAN_MODE === "disabled") {
        await pass(file, "skipped");
        return { scanStatus: "skipped" };
      }
      let verdict: ScanVerdict;
      try {
        verdict = await clamd.scan((await storage.get(file.storage_key)).body, ctx.signal);
      } catch (error) {
        if (ctx.signal.aborted) throw error;
        return scanFailed(file, error, ctx);
      }
      if (verdict.status === "infected") await infected(file, verdict.signature, ctx);
      else {
        await pass(file, "clean");
        metrics.recordFileScan("clean");
      }
      return { scanStatus: verdict.status === "infected" ? "infected" : "clean" };
    },
  };
}
