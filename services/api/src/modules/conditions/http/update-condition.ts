/** updateCondition (PRODUCT_SPEC §2.1, §5.6, §14): tick, responsibility, agency and comments, within the caller's field permissions. */
import type { Condition } from "@kr/contracts";
import type { FastifyInstance } from "fastify";
import { audit, auditContext, withTransaction } from "../../../platform/audit.js";
import { resolveJobAccess } from "../../../platform/authz.js";
import { assertNoFieldConflict, setEtag } from "../../../platform/concurrency.js";
import { NotFoundError } from "../../../platform/errors.js";
import type { ModuleDeps } from "../../../platform/module.js";
import { defineRoute } from "../../../platform/routes.js";
import { toCondition, toFileMeta } from "../../_shared/index.js";
import { touchJob } from "../../jobs/index.js";
import { loadEvidence, lockCurrentCondition, writeCondition } from "../data/conditions.js";
import { capabilitiesForConditionUpdate, planConditionUpdate } from "../domain/condition-update.js";

export function registerUpdateConditionRoute(app: FastifyInstance, deps: ModuleDeps): void {
  defineRoute(app, "updateCondition", async ({ auth, request, reply, params, body, expectedVersion }) => {
    // 404 for a job the caller cannot see, then 403 unless they hold the capability of every field they send.
    const access = await resolveJobAccess(deps.db, auth, params.jobId, capabilitiesForConditionUpdate(body));
    const jobId = access.job.id;
    const condition: Condition = await withTransaction(deps.db, async (trx) => {
      // A superseded condition (re-extracted meanwhile) is gone for the editor: 404, not 412.
      const row = await lockCurrentCondition(trx, jobId, params.conditionId);
      if (!row) throw new NotFoundError();
      const plan = planConditionUpdate(row, body, auth.user.id, deps.clock.now());
      // A stale version still saves when no field this edit changes was changed since (field-level merge, §14/§15).
      await assertNoFieldConflict(
        trx,
        { jobId, entity: { type: "condition", id: row.id } },
        { current: row.version, expected: expectedVersion },
        Object.keys(plan.changes ?? {}),
      );
      let current = row;
      if (plan.changes) {
        await touchJob(trx, jobId);
        current = await writeCondition(trx, row, plan.set, auth.user.id);
        await audit(trx, auditContext(request), {
          action: "condition.updated",
          entityType: "condition",
          entityId: row.id,
          jobId,
          changes: plan.changes,
        });
      }
      const evidence = await loadEvidence(trx, row.id);
      const uploaders = new Map(evidence.uploaders.map((u) => [u.id, u]));
      const emails = new Map(evidence.emails.map((e) => [e.file_id, e]));
      return toCondition(
        current,
        evidence.files.map((file) => {
          const own = file.uploaded_by !== null && file.uploaded_by === auth.user.id;
          return toFileMeta(file, {
            uploader: file.uploaded_by ? (uploaders.get(file.uploaded_by) ?? null) : null,
            canDelete:
              access.capabilities.includes("files.delete.any") ||
              (own && access.capabilities.includes("files.delete.own")),
            email: emails.get(file.id) ?? null,
          });
        }),
      );
    });
    setEtag(reply, condition.version);
    return condition;
  });
}
