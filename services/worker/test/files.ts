import { createHash, randomUUID } from "node:crypto";
import type { Db, FileKindValue, OperationRow, ScanStatusValue } from "@kr/db";
import { objectKeyFor, type ObjectStorage } from "@kr/storage";
import type { HandlerContext } from "../src/handlers/types.js";
import { captureLog, type CapturedLog } from "./log.js";

export interface TestFile {
  readonly id: string;
  readonly jobId: string;
  readonly key: string;
}

export interface FileOptions {
  readonly bytes?: Uint8Array | string;
  readonly name?: string;
  readonly kind?: FileKindValue;
  readonly scanStatus?: ScanStatusValue;
  readonly scanAttempts?: number;
  readonly scanRetriesExhausted?: boolean;
  readonly checkpointKey?: string;
  readonly slot?: string;
  /** Attach as evidence of this condition instead of to a checkpoint slot. */
  readonly conditionId?: string;
  /** Do not put the object in storage (to test a missing object). */
  readonly noObject?: boolean;
}

/** A files row (with its checkpoint state) and its object in storage. */
export async function insertFile(
  db: Db,
  storage: ObjectStorage,
  jobId: string,
  o: FileOptions = {},
): Promise<TestFile> {
  const id = randomUUID();
  const key = objectKeyFor(jobId, id);
  const bytes = Buffer.from(o.bytes ?? "synthetic file content");
  const checkpointKey = o.conditionId ? null : (o.checkpointKey ?? "i5_0");
  if (checkpointKey) {
    await db
      .insertInto("checkpoint_states")
      .values({ job_id: jobId, checkpoint_key: checkpointKey })
      .onConflict((c) => c.doNothing())
      .execute();
  }
  await db
    .insertInto("files")
    .values({
      id,
      job_id: jobId,
      checkpoint_key: checkpointKey,
      slot: o.conditionId ? null : (o.slot ?? "decision"),
      condition_id: o.conditionId ?? null,
      storage_key: key,
      original_name: o.name ?? "Decision Letter.pdf",
      kind: o.kind ?? "pdf",
      content_type: "application/octet-stream",
      size_bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest(),
      scan_status: o.scanStatus ?? "pending",
      scan_attempts: o.scanAttempts ?? 0,
      scan_retries_exhausted: o.scanRetriesExhausted ?? false,
    })
    .execute();
  if (!o.noObject) await storage.put({ key, body: bytes, contentType: "application/octet-stream" });
  return { id, jobId, key };
}

export function fileRow(db: Db, id: string) {
  return db.selectFrom("files").selectAll().where("id", "=", id).executeTakeFirstOrThrow();
}

/** What the poller hands a handler: the claimed operation (with the attempt number to test) and a logger. */
export function handlerContext(
  operation: OperationRow,
  o: { attempt?: number; signal?: AbortSignal } = {},
): HandlerContext & { readonly captured: CapturedLog } {
  const captured = captureLog();
  return {
    operation: { ...operation, attempts: o.attempt ?? 1 },
    signal: o.signal ?? new AbortController().signal,
    log: captured.log,
    captured,
  };
}
