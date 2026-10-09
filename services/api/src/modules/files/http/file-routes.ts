/** getFile and getFileContent (PRODUCT_SPEC §11, §11.1; ADR-0011): authorise, gate on the scan, stream with Range. */
import { InvalidRangeError, ObjectNotFoundError } from "@kr/storage";
import type { FastifyInstance } from "fastify";
import { NotFoundError } from "../../../platform/errors.js";
import type { ModuleDeps } from "../../../platform/module.js";
import { defineRoute } from "../../../platform/routes.js";
import { RangeNotSatisfiableError, assertServable, contentHeadersFor, parseRange } from "../domain/content-headers.js";
import { loadFileMeta } from "./file-view.js";
import { openFile } from "./open-file.js";

export function registerFileRoutes(app: FastifyInstance, deps: ModuleDeps): void {
  defineRoute(app, "getFile", async ({ auth, params }) => {
    const { file, access } = await openFile(deps, auth, params.fileId);
    return loadFileMeta(deps.db, file, { id: auth.user.id, capabilities: access.capabilities });
  });

  defineRoute(app, "getFileContent", async ({ auth, request, reply, params, query }) => {
    const { file } = await openFile(deps, auth, params.fileId);
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
