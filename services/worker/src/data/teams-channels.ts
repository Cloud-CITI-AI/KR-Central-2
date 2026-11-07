/** The channel cache and channel-creation writes (BE-7: Kysely only). */
import { enqueueOperation, type ChannelMembershipValue, type Database, type Db, type NewJobTeamsLink } from "@kr/db";
import type { Transaction } from "kysely";

type Executor = Db | Transaction<Database>;

export interface CachedChannel {
  readonly id: string;
  readonly displayName: string;
  readonly membershipType: ChannelMembershipValue;
}

/** Replaces the team's cached channels with what Graph listed (one transaction). */
export async function replaceChannelCache(
  db: Db,
  teamId: string,
  channels: readonly CachedChannel[],
  now: Date,
): Promise<void> {
  await db.transaction().execute(async (trx) => {
    await trx.deleteFrom("teams_channels").where("team_id", "=", teamId).execute();
    if (channels.length === 0) return;
    await trx
      .insertInto("teams_channels")
      .values(
        channels.map((c) => ({
          team_id: teamId,
          channel_id: c.id,
          display_name: c.displayName.slice(0, 50),
          folder_name: c.membershipType === "standard" ? c.displayName.slice(0, 255) : null,
          membership_type: c.membershipType,
          seen_at: now,
        })),
      )
      .execute();
  });
}

/** Age of the cache in seconds (null when empty). */
export async function channelCacheAge(db: Executor, teamId: string, now: Date): Promise<number | null> {
  const row = await db
    .selectFrom("teams_channels")
    .select((eb) => eb.fn.max("seen_at").as("seen"))
    .where("team_id", "=", teamId)
    .executeTakeFirst();
  const seen = row?.seen as Date | null | undefined;
  return seen ? Math.floor((now.getTime() - seen.getTime()) / 1000) : null;
}

export async function channelNameTaken(db: Executor, teamId: string, name: string): Promise<boolean> {
  const row = await db
    .selectFrom("teams_channels")
    .select("channel_id")
    .where("team_id", "=", teamId)
    .where((eb) => eb(eb.fn("lower", ["display_name"]), "=", name.toLowerCase()))
    .executeTakeFirst();
  return row !== undefined;
}

export async function insertCreatedLink(trx: Transaction<Database>, link: NewJobTeamsLink): Promise<void> {
  await trx.insertInto("job_teams_links").values(link).execute();
}

export async function hasActiveGlobalOp(db: Executor, type: "teams.list_channels"): Promise<boolean> {
  const row = await db
    .selectFrom("operations")
    .select("id")
    .where("job_id", "is", null)
    .where("type", "=", type)
    .where("status", "in", ["queued", "running"])
    .executeTakeFirst();
  return row !== undefined;
}

export async function queueListChannels(db: Executor): Promise<string> {
  const op = await enqueueOperation(db, {
    jobId: null,
    type: "teams.list_channels",
    payload: {},
    createdBy: null,
    maxAttempts: 1,
  });
  return op.id;
}
