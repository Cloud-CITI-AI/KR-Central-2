/**
 * conditions.extract (PRODUCT_SPEC §10.2): reads the WAPC Decision Letter in the parse thread, replaces the job's conditions
 * in one transaction and sets the approval date and expiry (never the outcome date). The user-facing summary is stored as the
 * operation result. Idempotent: an extraction that was already applied is not applied twice.
 */
import type { Db } from "@kr/db";
import type { ObjectStorage } from "@kr/storage";
import { CONDITIONAL_APPROVAL_CHECKPOINT_KEY, getCheckpoint, slotsOf } from "@kr/workflow";
import { z } from "zod";
import type { Clock } from "../clock.js";
import type { WorkerConfig } from "../config.js";
import { applyExtraction } from "../data/conditions.js";
import { findDocument } from "../data/files.js";
import { storable, summarise } from "../domain/extraction.js";
import { TaskError } from "../errors.js";
import { readObject } from "../objects.js";
import type { Parser } from "../parsing/isolate.js";
import type { Handler } from "./types.js";

const Payload = z.object({ fileId: z.uuid(), replaceExisting: z.boolean().default(false) });
const DECISION_SLOT = slotsOf(getCheckpoint(CONDITIONAL_APPROVAL_CHECKPOINT_KEY))[0]?.key;

export interface ConditionsExtractDeps {
  readonly db: Db;
  readonly storage: ObjectStorage;
  readonly parser: Parser;
  readonly clock: Clock;
  readonly config: Pick<WorkerConfig, "UPLOAD_MAX_BYTES" | "PDF_MAX_PAGES">;
}

export function conditionsExtractHandler({ db, storage, parser, clock, config }: ConditionsExtractDeps): Handler {
  return {
    timeoutMs: 120_000,
    async run(ctx) {
      const payload = Payload.safeParse(ctx.operation.payload);
      if (!payload.success) throw new TaskError("invalid_payload", "The task was not set up correctly.");
      const { fileId, replaceExisting } = payload.data;
      const file = await findDocument(db, fileId);
      const usable =
        file?.job_id === ctx.operation.job_id &&
        !file.deleted_at &&
        !file.purged_at &&
        file.kind === "pdf" &&
        file.checkpoint_key === CONDITIONAL_APPROVAL_CHECKPOINT_KEY &&
        file.slot === DECISION_SLOT &&
        (file.scan_status === "clean" || file.scan_status === "skipped");
      if (!usable)
        throw new TaskError("file_unavailable", "The Decision Letter is no longer available. Upload it again.");

      const data = await readObject(storage, file.storage_key, config.UPLOAD_MAX_BYTES);
      const { conditions, dates } = await parser.run(
        "decision-letter",
        { data, maxPages: config.PDF_MAX_PAGES },
        ctx.signal,
      );
      const found = storable(conditions);
      await db.transaction().execute((trx) =>
        applyExtraction(trx, {
          jobId: ctx.operation.job_id,
          fileId,
          operationId: ctx.operation.id,
          replaceExisting,
          conditions: found,
          approvalDate: dates.approvalDate,
          approvalExpiry: dates.approvalExpiry,
          now: clock.now(),
        }),
      );
      return summarise(found, dates);
    },
  };
}
