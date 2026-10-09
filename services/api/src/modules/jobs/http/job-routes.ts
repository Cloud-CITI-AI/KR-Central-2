/** createJob (PRODUCT_SPEC §6) and getJob. */
import { jobCapabilitiesFor } from "@kr/contracts";
import type { FastifyInstance } from "fastify";
import { requireCapability, resolveJobAccess } from "../../../platform/authz.js";
import { audit, auditContext, withTransaction } from "../../../platform/audit.js";
import { assertVersion, setEtag } from "../../../platform/concurrency.js";
import { NotFoundError } from "../../../platform/errors.js";
import { sendIdempotent, withIdempotency } from "../../../platform/idempotency.js";
import type { ModuleDeps } from "../../../platform/module.js";
import { defineRoute } from "../../../platform/routes.js";
import { lockActiveJob, updateJobRow } from "../data/job-updates.js";
import { duplicateJobNumberError, insertJobWithCheckpoints } from "../data/job-writes.js";
import { planJobUpdate } from "../domain/job-update.js";
import { loadJobDetail } from "./job-view.js";

export function registerJobRoutes(app: FastifyInstance, deps: ModuleDeps): void {
  defineRoute(app, "createJob", async ({ auth, request, reply, body }) => {
    requireCapability(auth, "jobs.create");
    const result = await withIdempotency(
      deps.db,
      { request, userId: auth.user.id, operationId: "createJob", body, clock: deps.clock },
      async (trx) => {
        const job = await insertJobWithCheckpoints(trx, auth.user.id, {
          jobNumber: body.jobNumber,
          address: body.address,
          clientName: body.clientName ?? null,
          subdivisionType: body.subdivisionType,
        });
        await audit(trx, auditContext(request), {
          action: "job.created",
          entityType: "job",
          entityId: job.id,
          jobId: job.id,
          changes: {
            jobNumber: { from: null, to: job.job_number },
            address: { from: null, to: job.address },
            clientName: { from: null, to: job.client_name },
            subdivisionType: { from: null, to: job.subdivision_type },
          },
        });
        const viewer = { id: auth.user.id, capabilities: jobCapabilitiesFor(auth.user.role, null), grantRole: null };
        return { status: 201, body: await loadJobDetail(trx, job.id, viewer, deps.clock.now()) };
      },
    );
    void reply.header("location", `/v1/jobs/${result.body.id}`);
    setEtag(reply, result.body.version);
    return sendIdempotent(reply, result);
  });

  defineRoute(app, "getJob", async ({ auth, reply, params }) => {
    const access = await resolveJobAccess(deps.db, auth, params.jobId, "job.read");
    const detail = await loadJobDetail(
      deps.db,
      params.jobId,
      { id: auth.user.id, capabilities: access.capabilities, grantRole: access.grantRole },
      deps.clock.now(),
    );
    setEtag(reply, detail.version);
    return detail;
  });

  defineRoute(app, "updateJob", async ({ auth, request, reply, params, body, expectedVersion }) => {
    const access = await resolveJobAccess(deps.db, auth, params.jobId, "job.edit");
    const viewer = { id: auth.user.id, capabilities: access.capabilities, grantRole: access.grantRole };
    const detail = await withTransaction(deps.db, async (trx) => {
      const current = await lockActiveJob(trx, params.jobId);
      if (!current) throw new NotFoundError();
      assertVersion(current.version, expectedVersion);
      const plan = planJobUpdate(current, body);
      if (!plan.isNoOp) {
        if (plan.set.job_number !== undefined) {
          const taken = await trx
            .selectFrom("jobs")
            .select("id")
            .where("job_number", "=", plan.set.job_number)
            .where("id", "<>", current.id)
            .where("deleted_at", "is", null)
            .executeTakeFirst();
          if (taken) throw duplicateJobNumberError(plan.set.job_number);
        }
        await updateJobRow(trx, current, plan.set);
        await audit(trx, auditContext(request), {
          action: "job.updated",
          entityType: "job",
          entityId: current.id,
          jobId: current.id,
          changes: plan.changes,
        });
      }
      return loadJobDetail(trx, current.id, viewer, deps.clock.now());
    });
    setEtag(reply, detail.version);
    return detail;
  });
}
