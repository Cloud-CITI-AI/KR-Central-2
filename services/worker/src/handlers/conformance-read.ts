/**
 * conformance.read (PRODUCT_SPEC §10.1): finds the conformed date of a Conformance Notification in the §10.1 order and
 * overwrites the job's conformed date, method, source file, stamp text and outcome date (+90 days). The AI step runs only when
 * the request, the flag and the key all allow it, and any failure of it falls through to the text rule: it never blocks.
 */
import { fromFileName } from "@kr/document-parsing";
import type { Db } from "@kr/db";
import type { ObjectStorage } from "@kr/storage";
import type { KrMetrics } from "@kr/telemetry";
import { CONFORMANCE_CHECKPOINT_KEY, getCheckpoint, slotsOf } from "@kr/workflow";
import { z } from "zod";
import type { StampReader } from "../clients/stamp-reader.js";
import { StampReaderError } from "../clients/stamp-reader.js";
import type { WorkerConfig } from "../config.js";
import { applyConformedDate } from "../data/conformance.js";
import { findDocument } from "../data/files.js";
import {
  findConformedDate,
  foundResult,
  noStampResult,
  unreadableResult,
  type ConformanceResult,
  type Found,
} from "../domain/conformance.js";
import { TaskError, describeError } from "../errors.js";
import type { FeatureFlags } from "../flags.js";
import { readObject } from "../objects.js";
import { isUnreadable, type Parser } from "../parsing/isolate.js";
import type { Handler } from "./types.js";

const Payload = z.object({ fileId: z.uuid(), allowAi: z.boolean().default(false) });
const CONFORMANCE_SLOT = slotsOf(getCheckpoint(CONFORMANCE_CHECKPOINT_KEY))[0]?.key;

export interface ConformanceReadDeps {
  readonly db: Db;
  readonly storage: ObjectStorage;
  readonly parser: Parser;
  /** `ai-stamp-reading` is read here (OpenFeature, CF-4), never from configuration. */
  readonly flags: FeatureFlags;
  /** Present only when the worker could build one (the flag is on and there is a key). */
  readonly stampReader?: StampReader | undefined;
  readonly metrics: Pick<KrMetrics, "recordStampReading">;
  readonly config: Pick<WorkerConfig, "UPLOAD_MAX_BYTES" | "ANTHROPIC_API_KEY">;
}

/** Runs `make` once; every later call gets the same promise. */
const once = <T>(make: () => Promise<T>): (() => Promise<T>) => {
  let promise: Promise<T> | undefined;
  return () => (promise ??= make());
};

export function conformanceReadHandler(deps: ConformanceReadDeps): Handler {
  const { db, storage, parser, flags, stampReader, metrics, config } = deps;
  return {
    timeoutMs: 240_000,
    async run(ctx) {
      const payload = Payload.safeParse(ctx.operation.payload);
      if (!payload.success) throw new TaskError("invalid_payload", "The task was not set up correctly.");
      const { fileId, allowAi } = payload.data;
      const file = await findDocument(db, fileId);
      const usable =
        file?.job_id === ctx.operation.job_id &&
        !file.deleted_at &&
        !file.purged_at &&
        file.kind === "pdf" &&
        file.checkpoint_key === CONFORMANCE_CHECKPOINT_KEY &&
        file.slot === CONFORMANCE_SLOT &&
        (file.scan_status === "clean" || file.scan_status === "skipped");
      if (!usable)
        throw new TaskError(
          "file_unavailable",
          "The Conformance Notification is no longer available. Upload it again.",
        );

      const aiAllowed =
        allowAi &&
        flags.isEnabled("ai-stamp-reading") &&
        Boolean(config.ANTHROPIC_API_KEY) &&
        stampReader !== undefined;
      const bytes = once(() => readObject(storage, file.storage_key, config.UPLOAD_MAX_BYTES));
      const page = once(async () => parser.run("conformance-page", { data: await bytes() }, ctx.signal));
      const asFound = (candidate: { date: string; method: Found["method"] } | null): Found | null =>
        candidate && { ...candidate, stampText: null };

      /** The AI step: any failure is counted and falls through to the text rule. */
      async function stampImage(): Promise<Found | null> {
        if (!aiAllowed) {
          metrics.recordStampReading("disabled");
          return null;
        }
        try {
          const png = await parser.run("pdf-render", { data: await bytes() }, ctx.signal);
          const reading = await stampReader.read(png, ctx.signal);
          metrics.recordStampReading("read");
          return reading.found && reading.date
            ? { date: reading.date, method: "stamp_image", stampText: reading.stampText }
            : null;
        } catch (error) {
          if (ctx.signal.aborted) throw error;
          metrics.recordStampReading(error instanceof StampReaderError ? error.reason : "error");
          ctx.log.warn(
            { event: "stamp_reading_failed", ...describeError(error) },
            "The stamp could not be read; using the text rule",
          );
          return null;
        }
      }

      let result: ConformanceResult;
      try {
        const found = await findConformedDate({
          fileName: () => asFound(fromFileName(file.original_name)),
          stampAnnotation: async () => asFound((await page()).annotation),
          stampImage,
          text: async () => asFound((await page()).text),
        });
        if (found)
          await db
            .transaction()
            .execute((trx) => applyConformedDate(trx, { jobId: ctx.operation.job_id, fileId, found }));
        result = found ? foundResult(found) : noStampResult(file.original_name);
      } catch (error) {
        if (ctx.signal.aborted || !isUnreadable(error)) throw error;
        result = unreadableResult(file.original_name);
      }
      return result;
    },
  };
}
