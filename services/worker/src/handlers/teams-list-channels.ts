/**
 * teams.list_channels (ADR-0015 A5): refreshes the cache of the configured team's channels (`Channel.ReadBasic.All`),
 * which the api reads for the picker and the create-job duplicate-name check. Global operation (no job). A no-op
 * with the flag off or no team set.
 */
import type { TeamsListChannelsResult } from "@kr/contracts";
import type { Db } from "@kr/db";
import type { Clock } from "../clock.js";
import type { WorkerConfig } from "../config.js";
import type { GraphTeamsClient } from "../clients/graph-teams.js";
import { replaceChannelCache } from "../data/teams-channels.js";
import { readTeamsSettings } from "../data/teams-settings.js";
import { TaskError } from "../errors.js";
import type { FeatureFlags } from "../flags.js";
import type { Handler, HandlerContext } from "./types.js";

export interface TeamsListChannelsDeps {
  readonly db: Db;
  readonly flags: FeatureFlags;
  readonly clock: Clock;
  readonly config: Pick<WorkerConfig, "TEAMS_GRAPH_TIMEOUT_MS">;
  readonly teams?: GraphTeamsClient | undefined;
}

export function teamsListChannelsHandler(deps: TeamsListChannelsDeps): Handler {
  return {
    timeoutMs: Math.max(120_000, deps.config.TEAMS_GRAPH_TIMEOUT_MS * 4),
    async run(ctx: HandlerContext): Promise<TeamsListChannelsResult> {
      if (!deps.flags.isEnabled("teams-file-sync") || !deps.teams) return { channels: 0 };
      const settings = await readTeamsSettings(deps.db);
      if (!settings.team_id) return { channels: 0 };
      try {
        const channels = await deps.teams.listChannels(settings.team_id, ctx.signal);
        await replaceChannelCache(deps.db, settings.team_id, channels, deps.clock.now());
        ctx.log.info({ event: "teams_channels_cached", channels: channels.length }, "Channel cache refreshed");
        return { channels: channels.length };
      } catch (error) {
        if (ctx.signal.aborted) throw error;
        throw new TaskError("graph_unavailable", "Teams did not answer.", { retryable: false, cause: error });
      }
    },
  };
}
