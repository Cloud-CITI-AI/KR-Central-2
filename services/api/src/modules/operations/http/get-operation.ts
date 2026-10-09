/** getOperation (ADR-0006): the status the web app polls while a document is being read. */
import type { FastifyInstance } from "fastify";
import { resolveJobAccess } from "../../../platform/authz.js";
import { NotFoundError } from "../../../platform/errors.js";
import type { ModuleDeps } from "../../../platform/module.js";
import { defineRoute } from "../../../platform/routes.js";
import { findOperation } from "../data/operations.js";
import { toOperation } from "../domain/operation-view.js";

/** Seconds a client should wait before polling a queued or running operation again. */
const RETRY_AFTER_SECONDS = "2";

export function registerGetOperationRoute(app: FastifyInstance, deps: ModuleDeps): void {
  defineRoute(app, "getOperation", async ({ auth, request, reply, params }) => {
    const op = await findOperation(deps.db, params.operationId);
    if (!op) throw new NotFoundError();
    // The operation belongs to its job: a caller who cannot see the job gets the same 404 as for an unknown id.
    await resolveJobAccess(deps.db, auth, op.job_id, "job.read");
    if (op.status === "queued" || op.status === "running") void reply.header("retry-after", RETRY_AFTER_SECONDS);
    return toOperation(op, () => {
      request.log.warn(
        { event: "operation_result_unreadable", operationId: op.id, operationType: op.type },
        "A succeeded operation has a result that does not match the contract; it was not returned",
      );
    });
  });
}
