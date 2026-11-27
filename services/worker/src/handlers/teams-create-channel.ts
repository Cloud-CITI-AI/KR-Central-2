/**
 * teams.create_channel (ADR-0015 A5, phase 3): creates a standard channel for the job in the configured team, records
 * the link (status provisioning) at once, waits for the channel's folder in the team site's library, creates the
 * three template folders (`100. Initial SURVEY`, `101. Subdivison Process` in KR's spelling, and the root folder) and
 * queues `teams.provision`. The name comes from `channelNameFor` (payload `name`, computed by the api). A name already
 * taken is reported as `channel_name_taken` and nothing is created; the person retries with a new job name or links by
 * hand. Idempotent: a re-run that finds the link in place completes with `created`.
 *
 * The channel's folder is found by name at the library root, as `teams.provision` does, and never through
 * `/teams/{id}/channels/{id}/filesFolder`: that call needs tenant-wide Files or Sites read, and the registration holds
 * `Sites.Selected` only (it answered 403 in staging). Once the channel exists the link is kept whatever happens next:
 * a later failure marks the link `error` (Relink finishes the set-up) instead of failing the task, so no retry can
 * create a second channel with a " (2)" suffix.
 */
import type { TeamsChannelCreateResult } from "@kr/contracts";
import type { Db } from "@kr/db";
import { channelNameWithSuffix } from "@kr/workflow";
import { z } from "zod";
import type { Clock } from "../clock.js";
import type { WorkerConfig } from "../config.js";
import { GraphError, type DriveItem, type GraphDriveClient } from "../clients/graph-drive.js";
import type { GraphChannel, GraphTeamsClient } from "../clients/graph-teams.js";
import { auditSystem, findLink, markLinkError } from "../data/teams.js";
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
/** Lookups of a new channel's folder before giving up (1 s, 2 s, 4 s, 8 s, 10 s between them: about 25 s). */
const CHANNEL_FOLDER_ATTEMPTS = 6;

export interface TeamsCreateChannelDeps {
  readonly db: Db;
  readonly flags: FeatureFlags;
  readonly clock: Clock;
  readonly config: Pick<WorkerConfig, "TEAMS_GRAPH_TIMEOUT_MS" | "TEAMS_TENANT_ID">;
  readonly graph?: GraphDriveClient | undefined;
  readonly teams?: GraphTeamsClient | undefined;
}

/** Log fields for a failure: our code plus Graph's status and error code (never its message, a path or a URL). */
function failureFields(error: unknown, failureCode: string): Record<string, unknown> {
  return error instanceof GraphError
    ? { failureCode, graphStatus: error.status, graphCode: error.code }
    : { failureCode };
}

/** The channel's folder at the library root, waiting while SharePoint creates it after the channel. */
async function waitForChannelFolder(
  graph: GraphDriveClient,
  driveId: string,
  channelName: string,
  signal: AbortSignal,
): Promise<DriveItem> {
  for (let i = 0; i < CHANNEL_FOLDER_ATTEMPTS; i += 1) {
    const folder = await graph.itemByPath(driveId, sharePointSafe(channelName), signal);
    if (folder?.isFolder) return folder;
    if (i < CHANNEL_FOLDER_ATTEMPTS - 1) await graph.sleep(Math.min(10_000, 1000 * 2 ** i), signal);
  }
  throw new GraphError("The channel's folder did not appear.", 404, "itemNotFound");
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
      const siteUrl = settings.team_site_url;
      if (!settings.sync_enabled || !settings.create_channels_enabled || !settings.team_id || !siteUrl) {
        return { status: "skipped", channelName: null, errorCode: "teams_not_configured" };
      }
      const existing = await findLink(db, jobId);
      if (existing) return { status: "created", channelName: existing.channel_name, errorCode: null };
      const teamId = settings.team_id;
      const signal = ctx.signal;
      let name = payload.data.name;

      // 1. create the channel: until it exists a failure leaves nothing behind and is reported as before
      let channel: GraphChannel;
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
        channel = await teams.createChannel(teamId, name, signal);
      } catch (error) {
        if (signal.aborted) throw error;
        if (error instanceof GraphError && error.status === 409) {
          return { status: "error", channelName: name, errorCode: "channel_name_taken" };
        }
        const code = linkErrorCode(error);
        if (code === "graph_unavailable") {
          throw new TaskError("graph_unavailable", "Teams did not answer.", { retryable: true, cause: error });
        }
        ctx.log.warn(
          { event: "teams_channel_create_failed", jobId, ...failureFields(error, code) },
          "Teams channel could not be created",
        );
        return { status: "error", channelName: name, errorCode: code };
      }

      // 2. the channel exists: link it now, so nothing below can lead to a second channel
      await db.transaction().execute(async (trx) => {
        await insertCreatedLink(trx, {
          job_id: jobId,
          team_id: teamId,
          team_site_url: siteUrl,
          channel_id: channel.id,
          channel_name: channel.displayName,
          teams_url: `https://teams.microsoft.com/l/channel/${encodeURIComponent(channel.id)}/${encodeURIComponent(channel.displayName)}?groupId=${teamId}&tenantId=${deps.config.TEAMS_TENANT_ID ?? ""}`,
          status: "provisioning",
          linked_by: ctx.operation.created_by,
        });
        await auditSystem(trx, "job.teams_channel_created", jobId, "job_teams_link", jobId, {
          channel_name: { from: null, to: channel.displayName },
        });
      });

      // 3. the template folders in the channel's folder, then provisioning
      try {
        const site = await graph.siteByUrl(siteUrl, signal);
        const drive = await graph.defaultDrive(site.id, signal);
        const channelFolder = await waitForChannelFolder(graph, drive.id, channel.displayName, signal);
        const children = await graph.children(drive.id, channelFolder.id, signal);
        for (const folder of [...TEMPLATE_FOLDERS, settings.root_folder]) {
          const safe = sharePointSafe(folder);
          if (children.some((c) => c.isFolder && c.name.toLowerCase() === safe.toLowerCase())) continue;
          await graph.createFolder(drive.id, channelFolder.id, safe, signal);
        }
        await enqueueOperation(db, { jobId, type: "teams.provision", payload: {}, createdBy: null });
      } catch (error) {
        if (signal.aborted) throw error;
        const code = linkErrorCode(error);
        await markLinkError(db, jobId, code);
        ctx.log.warn(
          { event: "teams_channel_create_failed", jobId, ...failureFields(error, code) },
          "Teams channel was created but its folders could not be set up",
        );
        return { status: "error", channelName: channel.displayName, errorCode: code };
      }
      ctx.log.info({ event: "teams_channel_created", jobId }, "Teams channel created");
      return { status: "created", channelName: channel.displayName, errorCode: null };
    },
  };
}
