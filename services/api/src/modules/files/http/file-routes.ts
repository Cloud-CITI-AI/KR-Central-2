/** getFile (PRODUCT_SPEC §11): the file's metadata for anyone who may see its job. */
import type { AuthContext } from "../../../platform/auth-context.js";
import { getCheckpoint } from "@kr/workflow";
import type { FastifyInstance } from "fastify";
import { resolveJobAccess, type JobAccess } from "../../../platform/authz.js";
import { NotFoundError } from "../../../platform/errors.js";
import type { ModuleDeps } from "../../../platform/module.js";
import { defineRoute } from "../../../platform/routes.js";
import { findFile } from "../data/files.js";
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
}
