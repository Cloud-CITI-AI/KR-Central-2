/** downloadJobPackage (PRODUCT_SPEC §5.8): every servable file of the job as one streamed zip laid out like the page. */
import { ZipArchive } from "archiver";
import type { Readable } from "node:stream";
import type { FastifyBaseLogger, FastifyInstance } from "fastify";
import { audit, auditContext, withTransaction } from "../../../platform/audit.js";
import { resolveJobAccess } from "../../../platform/authz.js";
import type { ModuleDeps } from "../../../platform/module.js";
import { defineRoute } from "../../../platform/routes.js";
import { loadPackageRows } from "../data/package.js";
import { contentDispositionFor } from "../domain/content-headers.js";
import { buildJobSummary } from "../domain/job-summary.js";
import { planPackage, type PackagePlan } from "../domain/package-layout.js";

/** Resolves when archiver has written the entry called `name`; rejects if the archive fails first. */
function appendEntry(
  archive: ZipArchive,
  body: Readable | Buffer,
  name: string,
  date: Date,
  store: boolean,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const onEntry = (entry: { name: string }) => {
      if (entry.name !== name) return;
      cleanup();
      resolve();
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      archive.off("entry", onEntry);
      archive.off("error", onError);
    };
    archive.on("entry", onEntry);
    archive.on("error", onError);
    archive.append(body, { name, date, store });
  });
}

/**
 * Adds the entries one at a time, opening each object only when the previous entry has been written, so memory and
 * storage connections stay flat however many files there are and nothing touches the disk. A failure destroys the
 * archive: the download then fails visibly instead of delivering a zip that silently lacks files.
 */
async function fillArchive(
  archive: ZipArchive,
  deps: Pick<ModuleDeps, "storage" | "clock">,
  plan: PackagePlan,
  summary: string,
  log: FastifyBaseLogger,
): Promise<void> {
  try {
    await appendEntry(archive, Buffer.from(summary, "utf8"), plan.summaryPath, deps.clock.now(), false);
    for (const { file, path } of plan.entries) {
      if (archive.destroyed) return;
      const object = await deps.storage.get(file.storageKey);
      const alreadyCompressed = file.kind === "image" || file.kind === "video";
      await appendEntry(archive, object.body, path, file.uploadedAt, alreadyCompressed).catch((error: unknown) => {
        object.body.destroy();
        throw error;
      });
    }
    await archive.finalize();
  } catch (error) {
    log.error({ event: "package_failed", err: error }, "The job package could not be completed");
    archive.destroy(error instanceof Error ? error : new Error("package failed"));
  }
}

export function registerPackageRoutes(app: FastifyInstance, deps: ModuleDeps): void {
  defineRoute(app, "downloadJobPackage", async ({ auth, request, reply, params }) => {
    const access = await resolveJobAccess(deps.db, auth, params.jobId, "package.download");
    const { job } = access;
    const rows = await loadPackageRows(deps.db, job.id, access.capabilities.includes("fee_proposal.view"));
    const now = deps.clock.now();
    const plan = planPackage({ jobNumber: job.job_number, address: job.address }, rows.files, rows.conditions);
    const summary = buildJobSummary({
      job: {
        jobNumber: job.job_number,
        address: job.address,
        clientName: job.client_name,
        subdivisionType: job.subdivision_type,
        conformedDate: job.conformed_date,
        outcomeDate: job.outcome_date,
      },
      states: rows.states,
      conditions: rows.conditions,
      notes: rows.notes,
      now,
    });
    // A bulk read of client documents: one audit row for the whole package (single files are not audited).
    await withTransaction(deps.db, (trx) =>
      audit(trx, auditContext(request), {
        action: "job.package_downloaded",
        entityType: "job",
        entityId: job.id,
        jobId: job.id,
        changes: { fileCount: { from: null, to: plan.entries.length } },
      }),
    );
    const archive = new ZipArchive({ zlib: { level: 6 } });
    reply.raw.once("close", () => {
      // The client went away before the end: stop reading from storage.
      if (!reply.raw.writableFinished) archive.destroy();
    });
    void fillArchive(archive, deps, plan, summary, request.log);
    return reply
      .type("application/zip")
      .headers({
        "content-disposition": contentDispositionFor("attachment", plan.zipName),
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      })
      .send(archive);
  });
}
