/** Finding the file a request is about, behind the same visibility rules for every route that takes a file id. */
import { getCheckpoint } from "@kr/workflow";
import type { FileRow } from "@kr/db";
import type { AuthContext } from "../../../platform/auth-context.js";
import { resolveJobAccess, type JobAccess } from "../../../platform/authz.js";
import { NotFoundError } from "../../../platform/errors.js";
import type { ModuleDeps } from "../../../platform/module.js";
import { findFile } from "../data/files.js";

/** The fee proposal's files are for fee_proposal.view holders only; everyone else gets the same 404 as for no file. */
function canSee(access: Pick<JobAccess, "capabilities">, checkpointKey: string | null): boolean {
  return (
    checkpointKey === null ||
    getCheckpoint(checkpointKey).restricted !== "fee_proposal" ||
    access.capabilities.includes("fee_proposal.view")
  );
}

/**
 * The file when it exists, is not removed and its job is visible to the caller (job.read; archived jobs and jobs of
 * other people are the same 404, never a 403).
 */
export async function openFile(
  deps: Pick<ModuleDeps, "db">,
  auth: AuthContext,
  fileId: string,
): Promise<{ file: FileRow; access: JobAccess }> {
  const file = await findFile(deps.db, fileId);
  if (!file) throw new NotFoundError();
  const access = await resolveJobAccess(deps.db, auth, file.job_id, "job.read");
  if (!canSee(access, file.checkpoint_key)) throw new NotFoundError();
  return { file, access };
}
