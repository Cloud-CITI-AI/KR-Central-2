/** deleteFile (PRODUCT_SPEC §2.1, §11): a soft delete, audited; the object is purged by the retention sweep. */
import type { FastifyInstance } from "fastify";
import { audit, auditContext, withTransaction } from "../../../platform/audit.js";
import { ForbiddenError, NotFoundError } from "../../../platform/errors.js";
import type { ModuleDeps } from "../../../platform/module.js";
import { defineRoute } from "../../../platform/routes.js";
import { softDeleteFile } from "../data/files.js";
import { canDeleteFile } from "./file-view.js";
import { openFile } from "./open-file.js";

export function registerDeleteRoutes(app: FastifyInstance, deps: ModuleDeps): void {
  defineRoute(app, "deleteFile", async ({ auth, request, reply, params }) => {
    const { file, access } = await openFile(deps, auth, params.fileId);
    // Staff may remove any file; everyone else only their own uploads.
    if (!canDeleteFile({ id: auth.user.id, capabilities: access.capabilities }, file)) throw new ForbiddenError();
    await withTransaction(deps.db, async (trx) => {
      // The row is only touched while it is still live, so two removals race to one winner and one 404.
      if (!(await softDeleteFile(trx, file.id, auth.user.id, deps.clock.now()))) throw new NotFoundError();
      await audit(trx, auditContext(request), {
        action: "file.deleted",
        entityType: "file",
        entityId: file.id,
        jobId: file.job_id,
        changes: {
          deleted: { from: false, to: true },
          name: { from: file.original_name, to: null },
        },
      });
    });
    return reply.code(204).send();
  });
}
