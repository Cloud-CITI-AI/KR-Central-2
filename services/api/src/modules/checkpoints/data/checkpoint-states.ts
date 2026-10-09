/** Versioned checkpoint_states writes (DATA_MODEL §6; BE-7: Kysely only). */
import type { CheckpointStateRow, Database } from "@kr/db";
import type { Transaction } from "kysely";
import { PreconditionFailedError } from "../../../platform/errors.js";
import type { StateColumns } from "../domain/checkpoint-update.js";

/** The row, locked for the rest of the transaction. */
export function lockCheckpointState(
  trx: Transaction<Database>,
  jobId: string,
  checkpointKey: string,
): Promise<CheckpointStateRow | undefined> {
  return trx
    .selectFrom("checkpoint_states")
    .selectAll()
    .where("job_id", "=", jobId)
    .where("checkpoint_key", "=", checkpointKey)
    .forUpdate()
    .executeTakeFirst();
}

/** `UPDATE … SET …, version = version + 1 WHERE … AND version = $n`; 0 rows means someone else got there first (412). */
export async function writeCheckpointState(
  trx: Transaction<Database>,
  current: Pick<CheckpointStateRow, "job_id" | "checkpoint_key" | "version">,
  set: StateColumns,
  updatedBy: string,
): Promise<void> {
  const row = await trx
    .updateTable("checkpoint_states")
    .set({ ...set, updated_by: updatedBy, version: current.version + 1 })
    .where("job_id", "=", current.job_id)
    .where("checkpoint_key", "=", current.checkpoint_key)
    .where("version", "=", current.version)
    .returning("version")
    .executeTakeFirst();
  if (!row) {
    throw new PreconditionFailedError({ detail: "This item was changed by someone else. Reload and try again." });
  }
}
