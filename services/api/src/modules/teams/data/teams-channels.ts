/** The worker's channel cache and channel-creation operations as the api reads and queues them (BE-7). */
import { enqueueOperation, type Database, type Db, type OperationRow, type TeamsChannelRow } from "@kr/db";
import type { Transaction } from "kysely";

type Executor = Db | Transaction<Database>;

export interface ChannelCache {
  readonly channels: TeamsChannelRow[];
  readonly cachedAt: Date | null;
}

export async function readChannelCache(db: Executor, teamId: string | null): Promise<ChannelCache> {
  if (!teamId) return { channels: [], cachedAt: null };
  const channels = await db
    .selectFrom("teams_channels")
    .selectAll()
    .where("team_id", "=", teamId)
    .orderBy("display_name")
    .execute();
  const cachedAt = channels.reduce<Date | null>((max, c) => (max && max > c.seen_at ? max : c.seen_at), null);
  return { channels, cachedAt };
}

export function nameTakenIn(cache: ChannelCache, name: string): boolean {
  return cache.channels.some((c) => c.display_name.toLowerCase() === name.toLowerCase());
}

export async function queueCreateChannel(
  trx: Transaction<Database>,
  jobId: string,
  name: string,
  createdBy: string,
): Promise<string> {
  const op = await enqueueOperation(trx, { jobId, type: "teams.create_channel", payload: { name }, createdBy });
  return op.id;
}

/** The newest channel-creation task of a job, for the panel's not-created state. */
export function latestCreateChannelOp(
  db: Executor,
  jobId: string,
): Promise<Pick<OperationRow, "id" | "status" | "result" | "error_code"> | undefined> {
  return db
    .selectFrom("operations")
    .select(["id", "status", "result", "error_code"])
    .where("job_id", "=", jobId)
    .where("type", "=", "teams.create_channel")
    .orderBy("created_at", "desc")
    .limit(1)
    .executeTakeFirst();
}
