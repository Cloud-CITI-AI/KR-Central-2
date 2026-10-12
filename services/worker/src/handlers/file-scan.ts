/**
 * file.scan (PRODUCT_SPEC §11, ADR-0011): streams the stored object to clamd and records clean / infected / error on the
 * file. Infected objects are deleted and audited; a scan that gives no verdict is never "clean". Idempotent: a re-run after
 * a lease expiry finds the verdict already recorded and only repeats the steps that follow it. Every exit stores
 * `{ scanStatus, followUpOperationId }` (FileScanResult): the task the scan queued for the file, or the one already queued.
 */
import { ObjectNotFoundError, type ObjectStorage } from "@kr/storage";
import type { Database, Db } from "@kr/db";
import type { Transaction } from "kysely";
import type { KrMetrics } from "@kr/telemetry";
import { z } from "zod";
import type { WorkerConfig } from "../config.js";
import { ClamdError, type ClamdClient, type ScanVerdict } from "../clients/clamd.js";
import {
  findScanFile,
  auditInfected,
  queueConformanceRead,
  queueEmailParse,
  saveScanResult,
  type ScanFile,
} from "../data/files.js";
import {
  isPermanentScanError,
  isScanLimitSignature,
  judgeScanError,
  mayRescan,
  type ScanErrorKind,
} from "../domain/scan.js";
import { TaskError } from "../errors.js";
import type { FeatureFlags } from "../flags.js";
import type { Handler, HandlerContext } from "./types.js";

const Payload = z.object({ fileId: z.uuid() });

export interface FileScanDeps {
  readonly db: Db;
  readonly storage: ObjectStorage;
  readonly clamd: ClamdClient;
  readonly config: Pick<WorkerConfig, "MALWARE_SCAN_MODE" | "CLAMAV_TIMEOUT_MS" | "SCAN_ERROR_MAX_RETRIES">;
  readonly metrics: Pick<KrMetrics, "recordFileScan">;
  /** `ai-stamp-reading` is carried into the conformance read an upload starts (the handler re-checks it). */
  readonly flags: FeatureFlags;
}

function errorKind(error: unknown): ScanErrorKind {
  if (error instanceof ClamdError) return error.code === "aborted" ? "timeout" : error.code;
  return error instanceof ObjectNotFoundError ? "object_missing" : "storage";
}

export function fileScanHandler(deps: FileScanDeps): Handler {
  const { db, storage, clamd, config, metrics, flags } = deps;

  /**
   * What follows a passed scan: an uploaded email is parsed; a PDF in the Conformance Notification slot is read. Returns the
   * id of the task queued (or already queued), which the scan's result names so the UI can follow it.
   */
  async function followUp(trx: Transaction<Database>, file: ScanFile): Promise<string | null> {
    return (
      (await queueEmailParse(trx, file)) ?? (await queueConformanceRead(trx, file, flags.isEnabled("ai-stamp-reading")))
    );
  }

  /** Records a passed scan and queues what follows it (email parse, conformance read) in the same transaction. */
  function pass(file: ScanFile, status: "clean" | "skipped"): Promise<string | null> {
    return db.transaction().execute(async (trx) => {
      await saveScanResult(trx, file.id, { status, detail: null });
      return followUp(trx, file);
    });
  }

  async function infected(file: ScanFile, signature: string, ctx: HandlerContext): Promise<void> {
    await db.transaction().execute(async (trx) => {
      await saveScanResult(trx, file.id, { status: "infected", detail: signature.slice(0, 500) });
      await auditInfected(trx, file, signature);
    });
    metrics.recordFileScan("infected");
    const limit = isScanLimitSignature(signature);
    ctx.log.error(
      { event: "malware_detected", fileId: file.id, signature, ...(limit && { scanLimitExceeded: true }) },
      limit
        ? "An upload went past a virus scan limit and is blocked; the object is deleted"
        : "Malware found in an upload; the object is deleted",
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
    const failedScans = await db.transaction().execute((trx) =>
      saveScanResult(trx, file.id, {
        status: "error",
        detail,
        failed: true,
        retry: { maxRetries: config.SCAN_ERROR_MAX_RETRIES, permanent: isPermanentScanError(kind) },
      }),
    );
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
      if (file?.job_id !== ctx.operation.job_id || file.deleted_at || file.purged_at)
        return { scanStatus: "gone", followUpOperationId: null };

      if (file.scan_status === "infected") {
        await storage.delete(file.storage_key);
        return { scanStatus: "infected", followUpOperationId: null };
      }
      if (file.scan_status === "clean" || file.scan_status === "skipped") {
        const followUpOperationId = await db.transaction().execute((trx) => followUp(trx, file));
        return { scanStatus: file.scan_status, followUpOperationId };
      }
      if (config.MALWARE_SCAN_MODE === "disabled") {
        return { scanStatus: "skipped", followUpOperationId: await pass(file, "skipped") };
      }
      let verdict: ScanVerdict;
      try {
        verdict = await clamd.scan((await storage.get(file.storage_key)).body, ctx.signal);
      } catch (error) {
        if (ctx.signal.aborted) throw error;
        return scanFailed(file, error, ctx);
      }
      if (verdict.status === "infected") {
        await infected(file, verdict.signature, ctx);
        return { scanStatus: "infected", followUpOperationId: null };
      }
      const followUpOperationId = await pass(file, "clean");
      metrics.recordFileScan("clean");
      return { scanStatus: "clean", followUpOperationId };
    },
  };
}
