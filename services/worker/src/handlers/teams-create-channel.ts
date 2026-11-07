/**
 * teams.create_channel (ADR-0015 A5, phase 3): creates a standard channel for the job in the configured team, waits
 * for its Files folder, creates the three template folders (`100. Initial SURVEY`, `101. Subdivison Process` in
 * KR's spelling, and the root folder), records the link (status provisioning) and queues `teams.provision`. The name
 * comes from `channelNameFor` (payload `name`, computed by the api). A name already taken is reported as
 * `channel_name_taken` and nothing is created; the person retries with a new job name or links by hand. Idempotent:
 * a re-run that finds the link in place completes with `created`.
 */
import type { TeamsChannelCreateResult } from "@kr/contracts";
import type { Db } from "@kr/db";
import { channelNameWithSuffix } from "@kr/workflow";
import { z } from "zod";
import type { Clock } from "../clock.js";
import type { WorkerConfig } from "../config.js";
import { GraphError, type GraphDriveClient } from "../clients/graph-drive.js";
import type { GraphTeamsClient } from "../clients/graph-teams.js";
import { auditSystem, findLink } from "../data/teams.js";
import { channelNameTaken, insertCreatedLink, replaceChannelCache } from "../data/teams-channels.js";
import { readTeamsSettings } from "../data/teams-settings.js";
import { sharePointSafe } from "../domain/teams-layout.js";
import { TaskError } from "../errors.js";
import type { FeatureFlags } from "../flags.js";
import { linkErrorCode } from "./teams-provision.js";
import { jobIdOf, type Handler, type HandlerContext } from "./types.js";
import { enqueueOperation } from "@kr/db";

const Payload = z.object({ name: z.string().min(1).max(50), suffixOnClash: z.boolean().default(true) });

/** Teams' template folders for a job channel (DECISIONS_LOG 29 Oct; the spelling of 101 is KR's). */
export const TEMPLATE_FOLDERS = ["100. Initial SURVEY", "101. Subdivison Process"] as const;
const FILES_FOLDER_ATTEMPTS = 6;

export interface TeamsCreateChannelDeps {
  readonly db: Db;
  readonly flags: FeatureFlags;
  readonly clock: Clock;
  readonly config: Pick<WorkerConfig, "TEAMS_GRAPH_TIMEOUT_MS" | "TEAMS_TENANT_ID">;
  readonly graph?: GraphDriveClient | undefined;
  readonly teams?: GraphTeamsClient | undefined;
}

export function teamsCreateChannelHandler(deps: TeamsCreateChannelDeps): Handler {
  const { db, clock } = deps;
  return {
    timeoutMs: Math.max(300_000, deps.config.TEAMS_GRAPH_TIMEOUT_MS * 10),
    async run(ctx: HandlerContext): Promise<TeamsChannelCreateResult> {
      const payload = Payload.safeParse(ctx.operation.payload);
      if (!payload.success) throw new TaskError("invalid_payload", "The task was not set up correctly.");
      const jobId = jobIdOf(ctx.operation);
      const { graph, teams } = deps;
      if (!deps.flags.isEnabled("teams-file-sync") || !graph || !teams)
        return { status: "skipped", channelName: null, errorCode: null };
      const settings = await readTeamsSettings(db);
      if (!settings.sync_enabled || !settings.create_channels_enabled || !settings.team_id || !settings.team_site_url) {
        return { status: "skipped", channelName: null, errorCode: "teams_not_configured" };
      }
      const existing = await findLink(db, jobId);
      if (existing) return { status: "created", channelName: existing.channel_name, errorCode: null };
      const teamId = settings.team_id;
      const signal = ctx.signal;
      let name = payload.data.name;
      try {
        // the cache may be stale: ask Graph, and take the next suffix for a reused job number (A5)
        const current = await teams.listChannels(teamId, signal);
        await replaceChannelCache(db, teamId, current, clock.now());
        if (await channelNameTaken(db, teamId, name)) {
          if (!payload.data.suffixOnClash) throw new GraphError("Name taken.", 409, "nameAlreadyExists");
          let n = 2;
          while (await channelNameTaken(db, teamId, channelNameWithSuffix(name, n))) n += 1;
          name = channelNameWithSuffix(name, n);
        }
        const channel = await teams.createChannel(teamId, name, signal);
        const filesFolder = await teams.channelFilesFolder(teamId, channel.id, FILES_FOLDER_ATTEMPTS, signal);
        const site = await graph.siteByUrl(settings.team_site_url, signal);
        const drive = await graph.defaultDrive(site.id, signal);
        const children = await graph.children(drive.id, filesFolder.id, signal);
        for (const folder of [...TEMPLATE_FOLDERS, settings.root_folder]) {
          const safe = sharePointSafe(folder);
          if (children.some((c) => c.isFolder && c.name.toLowerCase() === safe.toLowerCase())) continue;
          await graph.createFolder(drive.id, filesFolder.id, safe, signal);
        }
        await db.transaction().execute(async (trx) => {
          await insertCreatedLink(trx, {
            job_id: jobId,
            team_id: teamId,
            team_site_url: settings.team_site_url,
            channel_id: channel.id,
            channel_name: channel.displayName,
            teams_url: `https://teams.microsoft.com/l/channel/${encodeURIComponent(channel.id)}/${encodeURIComponent(channel.displayName)}?groupId=${teamId}&tenantId=${deps.config.TEAMS_TENANT_ID ?? ""}`,
            status: "provisioning",
            linked_by: ctx.operation.created_by,
          });
          await enqueueOperation(trx, { jobId, type: "teams.provision", payload: {}, createdBy: null });
          await auditSystem(trx, "job.teams_channel_created", jobId, "job_teams_link", jobId, {
            channel_name: { from: null, to: channel.displayName },
          });
        });
        ctx.log.info({ event: "teams_channel_created", jobId }, "Teams channel created");
        return { status: "created", channelName: channel.displayName, errorCode: null };
      } catch (error) {
        if (signal.aborted) throw error;
        if (error instanceof GraphError && error.status === 409) {
          return { status: "error", channelName: name, errorCode: "channel_name_taken" };
        }
        const code = linkErrorCode(error);
        if (code === "graph_unavailable") {
          throw new TaskError("graph_unavailable", "Teams did not answer.", { retryable: true, cause: error });
        }
        ctx.log.warn({ event: "teams_channel_create_failed", jobId, code }, "Teams channel could not be created");
        return { status: "error", channelName: name, errorCode: code };
      }
    },
  };
}
