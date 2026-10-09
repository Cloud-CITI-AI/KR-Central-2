/** uploadFile (PRODUCT_SPEC §5.5, §11; ADR-0011): authorise, sniff, stream to storage, record, queue the scan. */
import multipart from "@fastify/multipart";
import type { FastifyInstance } from "fastify";
import { requireJobCapability, resolveJobAccess } from "../../../platform/authz.js";
import { NotFoundError } from "../../../platform/errors.js";
import { sendIdempotent } from "../../../platform/idempotency.js";
import type { ModuleDeps } from "../../../platform/module.js";
import { defineRoute } from "../../../platform/routes.js";
import { conditionIsCurrent } from "../data/files.js";
import { discard, readUpload } from "./read-upload.js";
import { recordUpload } from "./record-upload.js";

/**
 * Plugin limits: a handful of short text fields and room for a second file part, which readUpload refuses with a 400
 * (one file per request); the file's own cap is applied by readUpload.
 */
const FIELD_LIMITS = { files: 2, fields: 4, fieldSize: 256, parts: 6, headerPairs: 40 } as const;

export function registerUploadRoutes(app: FastifyInstance, deps: ModuleDeps): void {
  void app.register(multipart, {
    // One byte more than the cap: the cap itself (capBytes) is the check that answers 413; this is a backstop.
    limits: { ...FIELD_LIMITS, fileSize: deps.config.UPLOAD_MAX_BYTES + 1 },
  });

  defineRoute(app, "uploadFile", async ({ auth, request, reply, params }) => {
    // 404 for a job the caller cannot see; the slot's own capability is checked once the fields are known.
    const access = await resolveJobAccess(deps.db, auth, params.jobId);
    const stored = await readUpload({
      request,
      storage: deps.storage,
      log: request.log,
      jobId: params.jobId,
      maxBytes: deps.config.UPLOAD_MAX_BYTES,
      authorise: async (target) => {
        for (const capability of target.required) requireJobCapability(access, capability);
        if (target.type === "evidence" && !(await conditionIsCurrent(deps.db, params.jobId, target.conditionId))) {
          throw new NotFoundError({ detail: "That condition no longer exists." });
        }
      },
    });
    const result = await recordUpload({ deps, request, auth, access, stored }).catch(async (error: unknown) => {
      await discard(deps.storage, request.log, stored.storageKey);
      throw error;
    });
    // A replay stored its own object first time round; this request's copy is an orphan.
    if (result.replayed) await discard(deps.storage, request.log, stored.storageKey);
    else void reply.header("location", `/v1/files/${result.body.file.id}`);
    return sendIdempotent(reply, result);
  });
}
