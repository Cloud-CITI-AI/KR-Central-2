/**
 * file.scan (PRODUCT_SPEC §11, ADR-0011): streams the stored object to clamd and records clean / infected / error on the
 * file. Infected objects are deleted and audited. Idempotent: a re-run after a lease expiry finds the verdict already
 * recorded and only repeats the steps that follow it.
 */
import type { ObjectStorage } from "@kr/storage";
import type { Db } from "@kr/db";
import type { KrMetrics } from "@kr/telemetry";
import { z } from "zod";
import type { WorkerConfig } from "../config.js";
import type { ClamdClient } from "../clients/clamd.js";
import { auditInfected, findScanFile, saveScanResult, type ScanFile } from "../data/files.js";
import { TaskError } from "../errors.js";
import type { Handler, HandlerContext } from "./types.js";

const Payload = z.object({ fileId: z.uuid() });

export interface FileScanDeps {
  readonly db: Db;
  readonly storage: ObjectStorage;
  readonly clamd: ClamdClient;
  readonly config: Pick<WorkerConfig, "MALWARE_SCAN_MODE" | "CLAMAV_TIMEOUT_MS">;
  readonly metrics: Pick<KrMetrics, "recordFileScan">;
}

export function fileScanHandler(deps: FileScanDeps): Handler {
  const { db, storage, clamd, config, metrics } = deps;

  async function pass(file: ScanFile, status: "clean" | "skipped"): Promise<void> {
    await db.transaction().execute((trx) => saveScanResult(trx, file.id, { status, detail: null }));
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
      if (file.scan_status === "clean" || file.scan_status === "skipped") return { scanStatus: file.scan_status };
      if (config.MALWARE_SCAN_MODE === "disabled") {
        await pass(file, "skipped");
        return { scanStatus: "skipped" };
      }
      const verdict = await clamd.scan((await storage.get(file.storage_key)).body, ctx.signal);
      if (verdict.status === "infected") await infected(file, verdict.signature, ctx);
      else {
        await pass(file, "clean");
        metrics.recordFileScan("clean");
      }
      return { scanStatus: verdict.status === "infected" ? "infected" : "clean" };
    },
  };
}
