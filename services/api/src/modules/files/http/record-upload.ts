/** The transaction of an upload: file row, scan operation, audit event and the stored response. */
import type { UploadResult } from "@kr/contracts";
import { enqueueOperation } from "@kr/db";
import type { FastifyRequest } from "fastify";
import type { z } from "zod";
import { toFileMeta } from "../../_shared/index.js";
import { audit, auditContext } from "../../../platform/audit.js";
import type { AuthContext } from "../../../platform/auth-context.js";
import type { JobAccess } from "../../../platform/authz.js";
import { BadRequestError, NotFoundError } from "../../../platform/errors.js";
import { withIdempotency } from "../../../platform/idempotency.js";
import type { ModuleDeps } from "../../../platform/module.js";
import { insertFile, lockActiveJob } from "../data/files.js";
import type { StoredUpload } from "./read-upload.js";

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
  const { target } = stored;
  const jobId = access.job.id;
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
      // Condition evidence is recorded by the next commit; until then it is refused (the object is removed).
      if (target.type !== "slot") {
        throw new BadRequestError({
          errors: [{ path: "conditionId", message: "Condition evidence is not supported yet." }],
        });
      }
      // The job may have been archived while the bytes were streaming.
      if (!(await lockActiveJob(trx, jobId))) throw new NotFoundError();
      const file = await insertFile(trx, {
        id: stored.fileId,
        jobId,
        target: { checkpointKey: target.checkpointKey, slot: target.slot.key },
        storageKey: stored.storageKey,
        originalName: stored.originalName,
        kind: stored.classification.kind,
        contentType: stored.classification.contentType,
        sizeBytes: stored.sizeBytes,
        sha256: stored.sha256,
        scanStatus: "pending",
        uploadedBy: auth.user.id,
        uploadedAt: deps.clock.now(),
      });
      // The worker scans the object; the file stays unopenable until it is clean (ADR-0011).
      const queued = await enqueueOperation(trx, {
        jobId,
        type: "file.scan",
        payload: { fileId: file.id },
        createdBy: auth.user.id,
      });
      await audit(trx, auditContext(request), {
        action: "file.uploaded",
        entityType: "file",
        entityId: file.id,
        jobId,
        changes: {
          name: { from: null, to: file.original_name },
          kind: { from: null, to: file.kind },
          sizeBytes: { from: null, to: stored.sizeBytes },
          checkpointKey: { from: null, to: target.checkpointKey },
          slot: { from: null, to: target.slot.key },
        },
      });
      const body: z.output<typeof UploadResult> = {
        file: toFileMeta(file, {
          uploader: { id: auth.user.id, display_name: auth.user.displayName },
          canDelete:
            access.capabilities.includes("files.delete.any") || access.capabilities.includes("files.delete.own"),
          email: null,
        }),
        operation: {
          id: queued.id,
          jobId,
          type: queued.type,
          status: queued.status,
          createdAt: queued.created_at.toISOString(),
          completedAt: null,
          result: null,
          error: null,
        },
      };
      return { status: 201, body };
    },
  );
}
