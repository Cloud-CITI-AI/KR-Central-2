/** The transaction of an upload: file row, email record, scan operation, audit event and the stored response. */
import type { UploadResult } from "@kr/contracts";
import { enqueueOperation } from "@kr/db";
import { CONFORMANCE_CHECKPOINT_KEY, getCheckpoint, slotsOf } from "@kr/workflow";
import type { FastifyRequest } from "fastify";
import type { z } from "zod";
import { toFileMeta } from "../../_shared/index.js";
import { audit, auditContext } from "../../../platform/audit.js";
import type { AuthContext } from "../../../platform/auth-context.js";
import type { JobAccess } from "../../../platform/authz.js";
import { NotFoundError } from "../../../platform/errors.js";
import { withIdempotency } from "../../../platform/idempotency.js";
import type { ModuleDeps } from "../../../platform/module.js";
import { toOperation } from "../../operations/index.js";
import { insertEmailMessage, insertFile, lockActiveJob, lockCurrentCondition } from "../data/files.js";
import { canDeleteFile } from "./file-view.js";
import type { StoredUpload } from "./read-upload.js";

const CONFORMANCE_SLOT = slotsOf(getCheckpoint(CONFORMANCE_CHECKPOINT_KEY))[0]?.key;

export interface RecordUploadOptions {
  readonly deps: ModuleDeps;
  readonly request: FastifyRequest;
  readonly auth: AuthContext;
  readonly access: JobAccess;
  readonly stored: StoredUpload;
}

/** Records an upload that is already in storage. A failure leaves the object for the caller to remove. */
export function recordUpload(o: RecordUploadOptions) {
  const { deps, request, auth, access, stored } = o;
  const jobId = access.job.id;
  const skipScan = deps.config.MALWARE_SCAN_MODE === "disabled";
  const isEmail = stored.classification.kind === "email";
  const isConformanceNotice =
    stored.classification.kind === "pdf" &&
    stored.target.type === "slot" &&
    stored.target.checkpointKey === CONFORMANCE_CHECKPOINT_KEY &&
    stored.target.slot.key === CONFORMANCE_SLOT;
  return withIdempotency(
    deps.db,
    {
      request,
      userId: auth.user.id,
      operationId: "uploadFile",
      // The key is bound to what was sent: the same key with another file or target is a different request.
      body: { ...stored.fields, name: stored.originalName, sha256: stored.sha256.toString("hex") },
      clock: deps.clock,
    },
    async (trx) => {
      // The job may have been archived, or the condition superseded, while the bytes were streaming.
      if (!(await lockActiveJob(trx, jobId))) throw new NotFoundError();
      if (stored.target.type === "evidence" && !(await lockCurrentCondition(trx, jobId, stored.target.conditionId))) {
        throw new NotFoundError({ detail: "That condition no longer exists." });
      }
      const file = await insertFile(trx, {
        id: stored.fileId,
        jobId,
        target:
          stored.target.type === "evidence"
            ? { conditionId: stored.target.conditionId }
            : { checkpointKey: stored.target.checkpointKey, slot: stored.target.slot.key },
        storageKey: stored.storageKey,
        originalName: stored.originalName,
        kind: stored.classification.kind,
        contentType: stored.classification.contentType,
        sizeBytes: stored.sizeBytes,
        sha256: stored.sha256,
        scanStatus: skipScan ? "skipped" : "pending",
        uploadedBy: auth.user.id,
        uploadedAt: deps.clock.now(),
      });
      const email = isEmail
        ? await insertEmailMessage(trx, { fileId: file.id, parseStatus: "pending", isPasted: false })
        : null;
      // The worker scans, then follows up (an email is parsed, a Conformance Notification is read); with scanning off
      // nothing else would queue the follow-up, so it is queued here.
      const type = skipScan ? (isEmail ? "email.parse" : isConformanceNotice ? "conformance.read" : null) : "file.scan";
      const queued = type
        ? await enqueueOperation(trx, {
            jobId,
            type,
            payload:
              type === "conformance.read"
                ? { jobId, fileId: file.id, allowAi: deps.flags.isEnabled("ai-stamp-reading") }
                : { fileId: file.id },
            createdBy: auth.user.id,
          })
        : null;
      await audit(trx, auditContext(request), {
        action: "file.uploaded",
        entityType: "file",
        entityId: file.id,
        jobId,
        changes: {
          name: { from: null, to: file.original_name },
          kind: { from: null, to: file.kind },
          sizeBytes: { from: null, to: stored.sizeBytes },
          ...(stored.target.type === "evidence"
            ? { conditionId: { from: null, to: stored.target.conditionId } }
            : {
                checkpointKey: { from: null, to: stored.target.checkpointKey },
                slot: { from: null, to: stored.target.slot.key },
              }),
        },
      });
      const body: z.output<typeof UploadResult> = {
        file: toFileMeta(file, {
          uploader: { id: auth.user.id, display_name: auth.user.displayName },
          canDelete: canDeleteFile({ id: auth.user.id, capabilities: access.capabilities }, file),
          email,
        }),
        operation: queued ? toOperation(queued) : null,
      };
      return { status: 201, body };
    },
  );
}
