/**
 * The Teams settings as the worker reads them at the start of every `teams.*` operation (ADR-0015 A2): never cached
 * across operations, so a change under Admin → Teams takes effect on the next task.
 */
import type { Database, Db, TeamsSettingsRow } from "@kr/db";
import type { Transaction } from "kysely";

export async function readTeamsSettings(db: Db | Transaction<Database>): Promise<TeamsSettingsRow> {
  return db.selectFrom("teams_settings").selectAll().where("singleton", "=", true).executeTakeFirstOrThrow();
}

/** Records the team's display name after a successful Test connection (the only field the worker writes). */
export async function saveTeamName(db: Db, teamName: string | null): Promise<void> {
  await db.updateTable("teams_settings").set({ team_name: teamName }).where("singleton", "=", true).execute();
}
