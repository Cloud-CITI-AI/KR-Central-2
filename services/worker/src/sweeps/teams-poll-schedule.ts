/**
 * Queues `teams.poll` for every linked job whose inbound check is due (ADR-0015 A4): every `inbound_poll_seconds`
 * from Admin → Teams, read on each tick so a change takes effect without a restart. Runs on its own timer because
 * the sweeps are hourly. Nothing is queued while inbound sync is off.
 */
import type { Db } from "@kr/db";
import type { Logger } from "@kr/logger";
import type { Clock } from "../clock.js";
import { channelCacheAge, hasActiveGlobalOp, queueListChannels } from "../data/teams-channels.js";
import { jobsDueForPoll, queuePoll } from "../data/teams-inbound.js";
import { readTeamsSettings } from "../data/teams-settings.js";

export interface PollSchedulerOptions {
  readonly db: Db;
  readonly log: Logger;
  readonly clock: Clock;
  /** How often the scheduler looks for due jobs (default 60 s). */
  readonly tickMs?: number;
}

export interface PollScheduler {
  /** One pass: queues what is due; returns how many. Exposed for tests and the sweep report. */
  tick(): Promise<number>;
  stop(): void;
}

export async function scheduleDuePolls(db: Db, clock: Clock): Promise<number> {
  const settings = await readTeamsSettings(db);
  if (!settings.sync_enabled) return 0;
  let queued = 0;
  if (settings.inbound_sync_enabled) {
    const due = await jobsDueForPoll(db, settings.inbound_poll_seconds, clock.now());
    for (const jobId of due) await queuePoll(db, jobId);
    queued += due.length;
  }
  // Phase 3: keep the channel cache (picker, duplicate-name check) no older than one interval.
  if (settings.create_channels_enabled && settings.team_id) {
    const age = await channelCacheAge(db, settings.team_id, clock.now());
    if (
      (age === null || age >= settings.inbound_poll_seconds) &&
      !(await hasActiveGlobalOp(db, "teams.list_channels"))
    ) {
      await queueListChannels(db);
      queued += 1;
    }
  }
  return queued;
}

export function startTeamsPollScheduler(o: PollSchedulerOptions): PollScheduler {
  let timer: NodeJS.Timeout | null = null;
  let running = false;
  const tick = async (): Promise<number> => {
    if (running) return 0;
    running = true;
    try {
      const queued = await scheduleDuePolls(o.db, o.clock);
      if (queued > 0) o.log.info({ event: "teams_polls_queued", queued }, "Queued Teams inbound checks");
      return queued;
    } catch (error) {
      o.log.warn(
        { event: "teams_poll_schedule_failed", errorName: error instanceof Error ? error.name : "unknown" },
        "Could not schedule Teams inbound checks",
      );
      return 0;
    } finally {
      running = false;
    }
  };
  timer = setInterval(() => void tick(), o.tickMs ?? 60_000);
  timer.unref();
  return {
    tick,
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}
