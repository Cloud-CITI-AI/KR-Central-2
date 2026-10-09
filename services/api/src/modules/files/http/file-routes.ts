/** getFile and getFileContent (PRODUCT_SPEC §11, §11.1; ADR-0011): authorise, gate on the scan, stream with Range. */
import type { AuthContext } from "../../../platform/auth-context.js";
import { InvalidRangeError, ObjectNotFoundError } from "@kr/storage";
import { getCheckpoint } from "@kr/workflow";
import type { FastifyInstance } from "fastify";
import { resolveJobAccess, type JobAccess } from "../../../platform/authz.js";
import { NotFoundError } from "../../../platform/errors.js";
import type { ModuleDeps } from "../../../platform/module.js";
import { defineRoute } from "../../../platform/routes.js";
import { findFile } from "../data/files.js";
import { RangeNotSatisfiableError, assertServable, contentHeadersFor, parseRange } from "../domain/content-headers.js";
import { loadFileMeta } from "./file-view.js";

/** The fee proposal's files are for fee_proposal.view holders only; everyone else gets the same 404 as for no file. */
function canSee(access: Pick<JobAccess, "capabilities">, checkpointKey: string | null): boolean {
  return (
    checkpointKey === null ||
    getCheckpoint(checkpointKey).restricted !== "fee_proposal" ||
    access.capabilities.includes("fee_proposal.view")
  );
}

export function registerFileRoutes(app: FastifyInstance, deps: ModuleDeps): void {
  /** The file when it exists, is not removed and its job is visible to the caller; 404 otherwise (never 403). */
  async function openFile(auth: AuthContext, fileId: string) {
    const file = await findFile(deps.db, fileId);
    if (!file) throw new NotFoundError();
    const access = await resolveJobAccess(deps.db, auth, file.job_id, "job.read");
    if (!canSee(access, file.checkpoint_key)) throw new NotFoundError();
    return { file, access };
  }

  defineRoute(app, "getFile", async ({ auth, params }) => {
    const { file, access } = await openFile(auth, params.fileId);
    return loadFileMeta(deps.db, file, { id: auth.user.id, capabilities: access.capabilities });
  });

  defineRoute(app, "getFileContent", async ({ auth, request, reply, params, query }) => {
    const { file } = await openFile(auth, params.fileId);
    assertServable(file.scan_status);
    const size = Number(file.size_bytes);
    const range = parseRange(request.headers.range, size);
    const headers = contentHeadersFor(file, query.disposition);
    const object = await deps.storage.get(file.storage_key, range ?? undefined).catch((error: unknown) => {
      if (error instanceof InvalidRangeError) throw new RangeNotSatisfiableError(size);
      if (error instanceof ObjectNotFoundError) {
        request.log.error({ event: "file_object_missing", fileId: file.id }, "A clean file has no stored object");
        throw new NotFoundError();
      }
      throw error;
    });
    void reply
      .code(range ? 206 : 200)
      .type(headers.contentType)
      .headers({
        "content-disposition": headers.contentDisposition,
        "content-length": String(range ? range.end - range.start + 1 : size),
        "accept-ranges": "bytes",
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
        ...(headers.contentSecurityPolicy ? { "content-security-policy": headers.contentSecurityPolicy } : {}),
        ...(range ? { "content-range": `bytes ${range.start}-${range.end}/${size}` } : {}),
      });
    return reply.send(object.body);
  });
}
