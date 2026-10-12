/** The rows behind a job package (PRODUCT_SPEC §5.8): files that may be served, current conditions, states, notes. */
import type { Database } from "@kr/db";
import { CHECKPOINTS, type Agency } from "@kr/workflow";
import type { Kysely } from "kysely";
import type { SummaryCondition, SummaryInput } from "../domain/job-summary.js";
import type { PackageCondition, PackageFile } from "../domain/package-layout.js";

const RESTRICTED_KEYS = CHECKPOINTS.filter((c) => c.restricted === "fee_proposal").map((c) => c.key);

export interface PackageRows {
  readonly files: readonly PackageFile[];
  readonly conditions: readonly (PackageCondition & SummaryCondition)[];
  readonly states: SummaryInput["states"];
  readonly notes: SummaryInput["notes"];
}

/**
 * @param canSeeFeeProposal when false the fee proposal's files are not even read
 * Only clean or skipped, non-removed files; files of a superseded condition are removed with it, but are left out here
 * as well.
 */
export async function loadPackageRows(
  db: Kysely<Database>,
  jobId: string,
  canSeeFeeProposal: boolean,
): Promise<PackageRows> {
  const conditionRows = await db
    .selectFrom("conditions")
    .selectAll()
    .where("job_id", "=", jobId)
    .where("superseded_at", "is", null)
    .orderBy("condition_number")
    .execute();
  let files = db
    .selectFrom("files")
    .selectAll()
    .where("job_id", "=", jobId)
    .where("deleted_at", "is", null)
    .where("scan_status", "in", ["clean", "skipped"])
    .orderBy("uploaded_at")
    .orderBy("id");
  if (!canSeeFeeProposal) {
    files = files.where((eb) =>
      eb.or([eb("checkpoint_key", "is", null), eb("checkpoint_key", "not in", RESTRICTED_KEYS)]),
    );
  }
  const states = await db
    .selectFrom("checkpoint_states")
    .select(["checkpoint_key", "status", "responsibility"])
    .where("job_id", "=", jobId)
    .execute();
  const notes = await db
    .selectFrom("job_notes")
    .select(["created_at", "audience", "body"])
    .where("job_id", "=", jobId)
    .where("deleted_at", "is", null)
    .orderBy("created_at")
    .orderBy("id")
    .execute();
  const current = new Set(conditionRows.map((c) => c.id));
  return {
    files: (await files.execute())
      .filter((f) => f.condition_id === null || current.has(f.condition_id))
      .map((f) => ({
        id: f.id,
        name: f.original_name,
        kind: f.kind,
        contentType: f.content_type,
        checkpointKey: f.checkpoint_key,
        conditionId: f.condition_id,
        storageKey: f.storage_key,
        uploadedAt: f.uploaded_at,
      })),
    // The database CHECK keeps the agency list closed, so the cast only names what is already guaranteed.
    conditions: conditionRows.map((c) => ({
      id: c.id,
      number: c.condition_number,
      agency: c.agency as Agency,
      agencyGuessed: c.agency_guessed,
      text: c.text,
      isCleared: c.is_cleared,
      krComment: c.kr_comment,
      clientComment: c.client_comment,
    })),
    states: states.map((s) => ({
      checkpointKey: s.checkpoint_key,
      status: s.status,
      responsibility: s.responsibility,
    })),
    notes: notes.map((n) => ({ createdAt: n.created_at, audience: n.audience, body: n.body })),
  };
}
