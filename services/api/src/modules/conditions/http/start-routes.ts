/** startConditionsExtraction and startConformanceReading (PRODUCT_SPEC §5.5, §10.1, §10.2; ADR-0006): enqueue and answer 202. */
import { enqueueOperation, type Database } from "@kr/db";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Transaction } from "kysely";
import { audit, auditContext } from "../../../platform/audit.js";
import { resolveJobAccess } from "../../../platform/authz.js";
import { BadRequestError, ConflictError } from "../../../platform/errors.js";
import { sendIdempotent, withIdempotency } from "../../../platform/idempotency.js";
import type { ModuleDeps } from "../../../platform/module.js";
import { defineRoute } from "../../../platform/routes.js";
import { toOperation } from "../../operations/index.js";
import { countCurrentConditions, findRequestedFile } from "../data/start-requests.js";
import {
  rejectConformanceFile,
  rejectExtractionFile,
  replaceExistingMessage,
  type Rejection,
} from "../domain/start-request.js";

/** Starting work is not safe to repeat blindly, so the key is mandatory here (the contract leaves it optional elsewhere). */
function requireIdempotencyKey(request: FastifyRequest): void {
  if (request.headers["idempotency-key"] === undefined) {
    throw new BadRequestError({
      errors: [{ path: "idempotency-key", message: "Send an Idempotency-Key header (8 to 128 printable characters)." }],
    });
  }
}

function assertAccepted(rejection: Rejection | null): void {
  if (rejection) throw new ConflictError({ detail: rejection.detail, type: rejection.type });
}

/** 202 with `Location: /v1/operations/{id}` (also on a replay of the same key). */
function accepted(
  reply: FastifyReply,
  result: Parameters<typeof sendIdempotent>[1] & { body: { id: string } },
): FastifyReply {
  void reply.header("location", `/v1/operations/${result.body.id}`);
  return sendIdempotent(reply, result);
}

export function registerStartRoutes(app: FastifyInstance, deps: ModuleDeps): void {
  const idempotent = (request: FastifyRequest, userId: string, operationId: string, body: unknown) =>
    ({ request, userId, operationId, body, clock: deps.clock }) as const;

  defineRoute(app, "startConditionsExtraction", async ({ auth, request, reply, params, body }) => {
    const access = await resolveJobAccess(deps.db, auth, params.jobId, "conditions.extract");
    requireIdempotencyKey(request);
    const result = await withIdempotency(
      deps.db,
      idempotent(request, auth.user.id, "startConditionsExtraction", body),
      async (trx: Transaction<Database>) => {
        const jobId = access.job.id;
        assertAccepted(rejectExtractionFile(await findRequestedFile(trx, jobId, body.fileId), jobId));
        const existing = await countCurrentConditions(trx, jobId);
        if (existing > 0 && !body.replaceExisting) {
          throw new ConflictError({ detail: replaceExistingMessage(existing) });
        }
        const op = await enqueueOperation(trx, {
          jobId,
          type: "conditions.extract",
          payload: { jobId, fileId: body.fileId, replaceExisting: body.replaceExisting },
          createdBy: auth.user.id,
        });
        await audit(trx, auditContext(request), {
          action: "conditions.extraction_requested",
          entityType: "operation",
          entityId: op.id,
          jobId,
          changes: {
            fileId: { from: null, to: body.fileId },
            replaceExisting: { from: null, to: body.replaceExisting },
          },
        });
        return { status: 202, body: toOperation(op) };
      },
    );
    return accepted(reply, result);
  });

  defineRoute(app, "startConformanceReading", async ({ auth, request, reply, params, body }) => {
    const access = await resolveJobAccess(deps.db, auth, params.jobId, "conformance.read");
    requireIdempotencyKey(request);
    const result = await withIdempotency(
      deps.db,
      idempotent(request, auth.user.id, "startConformanceReading", body),
      async (trx: Transaction<Database>) => {
        const jobId = access.job.id;
        assertAccepted(rejectConformanceFile(await findRequestedFile(trx, jobId, body.fileId), jobId));
        const allowAi = deps.flags.isEnabled("ai-stamp-reading");
        const op = await enqueueOperation(trx, {
          jobId,
          type: "conformance.read",
          payload: { jobId, fileId: body.fileId, allowAi },
          createdBy: auth.user.id,
        });
        await audit(trx, auditContext(request), {
          action: "conformance.reading_requested",
          entityType: "operation",
          entityId: op.id,
          jobId,
          changes: { fileId: { from: null, to: body.fileId } },
        });
        return { status: 202, body: toOperation(op) };
      },
    );
    return accepted(reply, result);
  });
}
