/** pasteEmail (PRODUCT_SPEC §5.5 `emails`): staff add a WAPC query email from pasted text. */
import { randomUUID } from "node:crypto";
import type { FileMeta } from "@kr/contracts";
import { enqueueOperation } from "@kr/db";
import { objectKeyFor } from "@kr/storage";
import { EMAILS_CHECKPOINT_KEY, findSlot } from "@kr/workflow";
import type { FastifyInstance } from "fastify";
import type { z } from "zod";
import { toFileMeta } from "../../_shared/index.js";
import { audit, auditContext } from "../../../platform/audit.js";
import { resolveJobAccess } from "../../../platform/authz.js";
import { NotFoundError } from "../../../platform/errors.js";
import { sendIdempotent, withIdempotency } from "../../../platform/idempotency.js";
import type { ModuleDeps } from "../../../platform/module.js";
import { defineRoute } from "../../../platform/routes.js";
import { insertEmailMessage, insertFile, lockActiveJob } from "../data/files.js";
import { PASTED_FROM, buildPastedEmail } from "../domain/pasted-email.js";
import { canDeleteFile } from "./file-view.js";
import { discard } from "./read-upload.js";

/** The slot of 4.3 "Queries from WAPC" (the workflow definition owns its key). */
const EMAIL_SLOT = findSlot(EMAILS_CHECKPOINT_KEY, "email")?.key ?? "email";

export function registerPasteRoutes(app: FastifyInstance, deps: ModuleDeps): void {
  defineRoute(app, "pasteEmail", async ({ auth, request, reply, params, body }) => {
    const access = await resolveJobAccess(deps.db, auth, params.jobId, "emails.add");
    const now = deps.clock.now();
    const email = buildPastedEmail(body.text, now);
    const fileId = randomUUID();
    const storageKey = objectKeyFor(params.jobId, fileId);
    const skipScan = deps.config.MALWARE_SCAN_MODE === "disabled";
    const stored = await deps.storage.put({
      key: storageKey,
      body: Buffer.from(email.content, "utf8"),
      contentType: "text/plain",
    });
    const result = await withIdempotency(
      deps.db,
      { request, userId: auth.user.id, operationId: "pasteEmail", body, clock: deps.clock },
      async (trx) => {
        if (!(await lockActiveJob(trx, params.jobId))) throw new NotFoundError();
        const file = await insertFile(trx, {
          id: fileId,
          jobId: params.jobId,
          target: { checkpointKey: EMAILS_CHECKPOINT_KEY, slot: EMAIL_SLOT },
          storageKey,
          originalName: email.fileName,
          kind: "email",
          contentType: "text/plain",
          sizeBytes: stored.size,
          sha256: Buffer.from(stored.sha256, "hex"),
          scanStatus: skipScan ? "skipped" : "pending",
          uploadedBy: auth.user.id,
          uploadedAt: now,
        });
        // Already parsed (we built it), but still a stored file: it is scanned like every other (ADR-0011).
        const record = await insertEmailMessage(trx, {
          fileId,
          parseStatus: "parsed",
          isPasted: true,
          subject: email.subject,
          fromText: PASTED_FROM,
          bodyText: body.text,
          sentAt: now,
          parsedAt: now,
        });
        if (!skipScan) {
          await enqueueOperation(trx, {
            jobId: params.jobId,
            type: "file.scan",
            payload: { fileId },
            createdBy: auth.user.id,
          });
        }
        // Free text (the subject, the body) is never copied into the audit trail; only its length.
        await audit(trx, auditContext(request), {
          action: "email.pasted",
          entityType: "file",
          entityId: fileId,
          jobId: params.jobId,
          changes: { textLength: { from: null, to: body.text.length } },
        });
        const meta: z.output<typeof FileMeta> = toFileMeta(file, {
          uploader: { id: auth.user.id, display_name: auth.user.displayName },
          canDelete: canDeleteFile({ id: auth.user.id, capabilities: access.capabilities }, file),
          email: record,
        });
        return { status: 201, body: meta };
      },
    ).catch(async (error: unknown) => {
      await discard(deps.storage, request.log, storageKey);
      throw error;
    });
    if (result.replayed) await discard(deps.storage, request.log, storageKey);
    else void reply.header("location", `/v1/files/${result.body.id}`);
    return sendIdempotent(reply, result);
  });
}
