/** Reads and writes of the teams_settings singleton (BE-7: Kysely only). */
import type { UserRef } from "@kr/contracts";
import {
  enqueueOperation,
  type Database,
  type Db,
  type OperationRow,
  type TeamsSettingsRow,
  type TeamsSettingsUpdate,
} from "@kr/db";
import type { Transaction } from "kysely";

type Executor = Db | Transaction<Database>;

export interface SettingsRead {
  readonly row: TeamsSettingsRow;
  readonly updatedBy: UserRef | null;
  readonly lastCheck: Pick<OperationRow, "id" | "status" | "created_at"> | null;
}

/** The one settings row (inserted by migration 0005). Throws when missing: a database without it is not migrated. */
export async function readSettingsRow(db: Executor, lock = false): Promise<TeamsSettingsRow> {
  let q = db.selectFrom("teams_settings").selectAll().where("singleton", "=", true);
  if (lock) q = q.forUpdate();
  return q.executeTakeFirstOrThrow();
}

export async function readSettings(db: Executor): Promise<SettingsRead> {
  const row = await readSettingsRow(db);
  const [user, lastCheck] = await Promise.all([
    row.updated_by
      ? db.selectFrom("users").select(["id", "display_name"]).where("id", "=", row.updated_by).executeTakeFirst()
      : Promise.resolve(undefined),
    db
      .selectFrom("operations")
      .select(["id", "status", "created_at"])
      .where("type", "=", "teams.check")
      .where("job_id", "is", null)
      .orderBy("created_at", "desc")
      .limit(1)
      .executeTakeFirst(),
  ]);
  return {
    row,
    updatedBy: user ? { id: user.id, displayName: user.display_name } : null,
    lastCheck: lastCheck ?? null,
  };
}

export async function updateSettingsRow(
  trx: Transaction<Database>,
  set: TeamsSettingsUpdate,
  updatedBy: string,
  now: Date,
): Promise<TeamsSettingsRow> {
  return trx
    .updateTable("teams_settings")
    .set({ ...set, updated_by: updatedBy, updated_at: now, version: (eb) => eb("version", "+", 1) })
    .where("singleton", "=", true)
    .returningAll()
    .executeTakeFirstOrThrow();
}

/** A queued or running `teams.check`, if one exists (the page runs one at a time). */
export async function findActiveCheck(db: Executor): Promise<Pick<OperationRow, "id"> | undefined> {
  return db
    .selectFrom("operations")
    .select("id")
    .where("type", "=", "teams.check")
    .where("job_id", "is", null)
    .where("status", "in", ["queued", "running"])
    .executeTakeFirst();
}

export async function queueCheck(trx: Transaction<Database>, createdBy: string): Promise<OperationRow> {
  return enqueueOperation(trx, { jobId: null, type: "teams.check", payload: {}, createdBy, maxAttempts: 1 });
}
