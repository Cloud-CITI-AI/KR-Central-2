/**
 * teams.check (PRODUCT_SPEC §9.3 Test connection, ADR-0015 A2): runs the settings page's checks in order against
 * Microsoft Graph and stores `{ results, skipped }` (TeamsCheckResult) as the operation result. A failed prerequisite
 * skips what depends on it. The team-site write check creates a probe folder `.kr-tracker-check-{operationId}` under
 * the root folder and deletes it again; nothing else in the site is touched. Global operation: no job.
 */
import type { TeamsCheckResult } from "@kr/contracts";
import type { Db, TeamsSettingsRow } from "@kr/db";
import type { Clock } from "../clock.js";
import type { WorkerConfig } from "../config.js";
import { GraphError, type GraphDriveClient } from "../clients/graph-drive.js";
import type { GraphTeamsClient } from "../clients/graph-teams.js";
import { GraphTokenError } from "../clients/graph-token.js";
import { readTeamsSettings, saveTeamName } from "../data/teams-settings.js";
import { replaceChannelCache } from "../data/teams-channels.js";
import { TaskError } from "../errors.js";
import type { FeatureFlags } from "../flags.js";
import type { Handler, HandlerContext } from "./types.js";

type Item = TeamsCheckResult["results"][number]["item"];

export const PROBE_FOLDER_PREFIX = ".kr-tracker-check-";

export interface TeamsCheckDeps {
  readonly db: Db;
  readonly flags: FeatureFlags;
  readonly config: Pick<WorkerConfig, "TEAMS_GRAPH_TIMEOUT_MS">;
  readonly clock: Clock;
  /** Absent when the flag is off (main builds it only with the registration present). */
  readonly graph?: GraphDriveClient | undefined;
  readonly teams?: GraphTeamsClient | undefined;
}

/** `403 accessDenied` style display of a failure (never a message, path or URL). */
export function failureCode(error: unknown): string {
  if (error instanceof GraphError) return error.display;
  if (error instanceof GraphTokenError) return `${error.status ?? "network"}${error.code ? ` ${error.code}` : ""}`;
  return "error";
}

/** The checks a settings row calls for, in order; phase 3 checks only when channel creation is on. */
export function plannedChecks(
  settings: Pick<TeamsSettingsRow, "fee_proposal_policy" | "create_channels_enabled">,
): Item[] {
  const items: Item[] = ["token", "team_site", "team_site_write"];
  if (settings.fee_proposal_policy === "restricted") items.push("fee_site", "fee_site_write");
  if (settings.create_channels_enabled) items.push("channel_list", "channel_create");
  return items;
}

export function teamsCheckHandler(deps: TeamsCheckDeps): Handler {
  const { db, flags } = deps;

  return {
    timeoutMs: Math.max(60_000, deps.config.TEAMS_GRAPH_TIMEOUT_MS * 8),
    async run(ctx: HandlerContext): Promise<TeamsCheckResult> {
      const settings = await readTeamsSettings(db);
      const planned = plannedChecks(settings);
      const results: TeamsCheckResult["results"] = [];
      const skipped: Item[] = [];
      const graph = deps.graph;
      if (!flags.isEnabled("teams-file-sync") || !graph) {
        // The page cannot reach this route with the flag off; a queued check from before a redeploy reports it plainly.
        throw new TaskError("teams_not_configured", "The Teams integration is not enabled on the worker.");
      }
      if (!settings.team_id || !settings.team_site_url) {
        throw new TaskError("teams_not_configured", "Teams settings are incomplete. Check Admin → Teams.");
      }
      const siteUrl = settings.team_site_url;
      const signal = ctx.signal;
      let teamName: string | null = null;
      let failedPrerequisite = false;

      const step = async (item: Item, dependsOn: boolean, call: () => Promise<void>): Promise<boolean> => {
        if (!planned.includes(item)) return false;
        if (!dependsOn || failedPrerequisite) {
          skipped.push(item);
          return false;
        }
        try {
          await call();
          results.push({ item, ok: true, errorCode: null });
          return true;
        } catch (error) {
          if (signal.aborted) throw error;
          ctx.log.warn(
            { event: "teams_check_failed", item, code: failureCode(error) },
            "A Teams settings check failed",
          );
          results.push({ item, ok: false, errorCode: failureCode(error) });
          return false;
        }
      };

      // 1. token: a Graph call that needs nothing but the registration (the token itself) — resolving the team site
      //    doubles as the first authorised request, so "token" is judged by whether a token could be obtained at all.
      let site: Awaited<ReturnType<GraphDriveClient["siteByUrl"]>> | null = null;
      const tokenOk = await step("token", true, async () => {
        try {
          site = await graph.siteByUrl(siteUrl, signal);
        } catch (error) {
          // a Graph answer (even 404/403) proves the token worked; only a token failure fails this item
          if (error instanceof GraphTokenError) throw error;
          if (error instanceof GraphError && error.status === 401) throw error;
        }
      });
      if (!tokenOk) failedPrerequisite = true;

      // 2. team site resolvable
      const siteOk = await step("team_site", tokenOk, async () => {
        site ??= await graph.siteByUrl(siteUrl, signal);
        teamName = site.displayName;
      });
      if (!siteOk) failedPrerequisite = true;

      // 3. write on the team site: create and delete a probe folder under the root folder (created if missing)
      await step("team_site_write", siteOk, async () => {
        const resolved = site;
        if (!resolved) throw new GraphError("no site", null, null);
        const drive = await graph.defaultDrive(resolved.id, signal);
        const root =
          (await graph.itemByPath(drive.id, settings.root_folder, signal)) ??
          (await graph.createFolder(drive.id, (await graph.root(drive.id, signal)).id, settings.root_folder, signal));
        const probe = await graph.createFolder(drive.id, root.id, `${PROBE_FOLDER_PREFIX}${ctx.operation.id}`, signal);
        await graph.deleteItem(drive.id, probe.id, probe.eTag, signal);
      });

      // 4–5. the Fee Proposals channel's site (restricted policy only)
      let feeSite: Awaited<ReturnType<GraphDriveClient["siteByUrl"]>> | null = null;
      const feeOk = await step("fee_site", siteOk, async () => {
        if (!settings.fee_site_url) throw new GraphError("no fee site", null, "fee_site_missing");
        feeSite = await graph.siteByUrl(settings.fee_site_url, signal);
      });
      await step("fee_site_write", feeOk, async () => {
        const resolved = feeSite;
        if (!resolved) throw new GraphError("no fee site", null, null);
        const drive = await graph.defaultDrive(resolved.id, signal);
        const root = await graph.root(drive.id, signal);
        const probe = await graph.createFolder(drive.id, root.id, `${PROBE_FOLDER_PREFIX}${ctx.operation.id}`, signal);
        await graph.deleteItem(drive.id, probe.id, probe.eTag, signal);
      });

      // 6. channel listing (`Channel.ReadBasic.All`, E17) — also refreshes the cache the picker reads
      const teamId = settings.team_id;
      const listOk = await step("channel_list", siteOk, async () => {
        if (!deps.teams) throw new GraphError("No Teams client.", null, "teams_client_missing");
        const channels = await deps.teams.listChannels(teamId, signal);
        await replaceChannelCache(db, teamId, channels, deps.clock.now());
      });
      // 7. channel creation needs `Channel.Create`; nothing is created here, so it is reported as not checked until a
      //    job creates one (the first real creation proves it). Listing passing is the prerequisite.
      if (planned.includes("channel_create")) {
        if (listOk) results.push({ item: "channel_create", ok: true, errorCode: "not_probed" });
        else skipped.push("channel_create");
      }

      if (siteOk) await saveTeamName(db, teamName);
      ctx.log.info(
        {
          event: "teams_check_finished",
          passed: results.filter((r) => r.ok).length,
          failed: results.filter((r) => !r.ok).length,
        },
        "Teams settings check finished",
      );
      return { results, skipped };
    },
  };
}
