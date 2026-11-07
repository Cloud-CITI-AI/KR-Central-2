/**
 * teams.provision (ADR-0015 decisions 4, 6 and 7): resolves the linked channel's folder in the link's team site,
 * creates the root folder and every layout folder inside it (reusing what exists, never renaming or deleting, never
 * touching anything else in the channel), stores the folder ids, marks the link ready, queues every clean file of the
 * job for pushing (fee-proposal files as excluded) and queues one `teams.push`. Idempotent: a second run finds the
 * folders and creates nothing. With copying off, or no link, it completes as a no-op (TeamsProvisionResult.skipped).
 */
import type { TeamsProvisionResult } from "@kr/contracts";
import type { Db, TeamsSettingsRow } from "@kr/db";
import type { Clock } from "../clock.js";
import type { WorkerConfig } from "../config.js";
import { GraphError, type DriveItem, type GraphDriveClient } from "../clients/graph-drive.js";
import { GraphTokenError } from "../clients/graph-token.js";
import { CircuitOpenError } from "../clients/circuit-breaker.js";
import {
  auditSystem,
  ensurePushRow,
  findLink,
  listCleanFiles,
  markLinkError,
  markLinkReady,
  queuePush,
  readFolders,
  saveFolder,
} from "../data/teams.js";
import { readTeamsSettings } from "../data/teams-settings.js";
import { layoutFolders, parentPaths, sharePointSafe } from "../domain/teams-layout.js";
import { syncPolicyFor } from "../domain/teams-policy.js";
import { TaskError } from "../errors.js";
import type { FeatureFlags } from "../flags.js";
import { jobIdOf, type Handler, type HandlerContext } from "./types.js";

export interface TeamsProvisionDeps {
  readonly db: Db;
  readonly flags: FeatureFlags;
  readonly clock: Clock;
  readonly config: Pick<WorkerConfig, "TEAMS_GRAPH_TIMEOUT_MS">;
  readonly graph?: GraphDriveClient | undefined;
}

const skipped = (): TeamsProvisionResult => ({ status: "skipped", foldersCreated: 0, filesQueued: 0, errorCode: null });

/** The error code a link shows for a Graph failure (PRODUCT_SPEC §5.10 error texts). */
export function linkErrorCode(error: unknown): string {
  if (error instanceof CircuitOpenError) return "graph_unavailable";
  if (error instanceof GraphError) {
    if (error.kind === "not_found") return "channel_folder_missing";
    if (error.kind === "permission_denied") return "permission_denied";
    if (error.kind === "graph_unavailable") return "graph_unavailable";
    return `graph_${error.status ?? "error"}`;
  }
  if (error instanceof GraphTokenError)
    return error.status === 401 || error.status === 400 ? "permission_denied" : "graph_unavailable";
  return "provision_failed";
}

/** A folder tree walker that reuses stored ids, then existing children, and creates what is missing. */
export class FolderResolver {
  private readonly created: string[] = [];
  private readonly childrenCache = new Map<string, Map<string, DriveItem>>();

  constructor(
    private readonly graph: GraphDriveClient,
    private readonly db: Db,
    private readonly jobId: string,
    private readonly driveId: string,
    private readonly rootItemId: string,
    private readonly known: Map<string, string>,
    private readonly signal: AbortSignal,
  ) {}

  get createdPaths(): readonly string[] {
    return this.created;
  }

  private async children(parentId: string): Promise<Map<string, DriveItem>> {
    let cached = this.childrenCache.get(parentId);
    if (!cached) {
      cached = new Map(
        (await this.graph.children(this.driveId, parentId, this.signal)).map((c) => [c.name.toLowerCase(), c]),
      );
      this.childrenCache.set(parentId, cached);
    }
    return cached;
  }

  /** The item id of a folder path (relative to the root folder), creating it and its parents when missing. */
  async resolve(path: string): Promise<string> {
    const stored = this.known.get(path);
    if (stored) return stored;
    const parents = parentPaths(path);
    const parentId = parents.length === 0 ? this.rootItemId : await this.resolve(parents[parents.length - 1] ?? "");
    const name = sharePointSafe(path.split("/").at(-1) ?? "");
    const siblings = await this.children(parentId);
    let item = siblings.get(name.toLowerCase());
    if (item && !item.isFolder) throw new GraphError("A file sits where a folder should be.", 409, "nameAlreadyExists");
    if (!item) {
      try {
        item = await this.graph.createFolder(this.driveId, parentId, name, this.signal);
        this.created.push(path);
      } catch (error) {
        // created by someone else between our listing and our call: use theirs
        if (!(error instanceof GraphError && error.status === 409)) throw error;
        this.childrenCache.delete(parentId);
        const again = (await this.children(parentId)).get(name.toLowerCase());
        if (!again?.isFolder) throw error;
        item = again;
      }
      siblings.set(name.toLowerCase(), item);
    }
    await saveFolder(this.db, this.jobId, path, item.id);
    this.known.set(path, item.id);
    return item.id;
  }
}

export function teamsProvisionHandler(deps: TeamsProvisionDeps): Handler {
  const { db, flags, clock } = deps;

  return {
    timeoutMs: Math.max(300_000, deps.config.TEAMS_GRAPH_TIMEOUT_MS * 20),
    async run(ctx: HandlerContext): Promise<TeamsProvisionResult> {
      const jobId = jobIdOf(ctx.operation);
      const graph = deps.graph;
      if (!flags.isEnabled("teams-file-sync") || !graph) return skipped();
      const settings: TeamsSettingsRow = await readTeamsSettings(db);
      if (!settings.sync_enabled) return skipped();
      const link = await findLink(db, jobId);
      if (!link) return skipped();
      const siteUrl = link.team_site_url ?? (link.team_id === settings.team_id ? settings.team_site_url : null);
      if (!siteUrl) {
        await markLinkError(db, jobId, "teams_not_configured");
        return { status: "error", foldersCreated: 0, filesQueued: 0, errorCode: "teams_not_configured" };
      }
      const signal = ctx.signal;
      try {
        const site = await graph.siteByUrl(siteUrl, signal);
        const drive = await graph.defaultDrive(site.id, signal);
        // The channel's folder sits at the library root under the channel's name (decision 4, V3).
        const channelFolder = await graph.itemByPath(drive.id, sharePointSafe(link.channel_name), signal);
        if (!channelFolder?.isFolder) throw new GraphError("Channel folder not found.", 404, "itemNotFound");
        const known = await readFolders(db, jobId);
        const rootName = sharePointSafe(settings.root_folder);
        const rootExisting = (await graph.children(drive.id, channelFolder.id, signal)).find(
          (c) => c.isFolder && c.name.toLowerCase() === rootName.toLowerCase(),
        );
        let createdRoot = 0;
        let root = rootExisting;
        if (!root) {
          root = await graph.createFolder(drive.id, channelFolder.id, rootName, signal);
          createdRoot = 1;
        }
        const resolver = new FolderResolver(graph, db, jobId, drive.id, root.id, known, signal);
        for (const path of layoutFolders()) await resolver.resolve(path);
        const now = clock.now();
        await markLinkReady(
          db,
          jobId,
          {
            drive_id: drive.id,
            channel_folder_item_id: channelFolder.id,
            root_folder_item_id: root.id,
            sharepoint_url: root.webUrl,
            team_site_url: siteUrl,
          },
          now,
        );
        // Every clean file already on the job is copied after linking (open question 4, the default).
        let filesQueued = 0;
        await db.transaction().execute(async (trx) => {
          for (const file of await listCleanFiles(trx, jobId)) {
            const policy = syncPolicyFor(file.checkpoint_key, settings);
            if (policy === "sync" || (policy === "restricted" && settings.fee_site_url)) {
              if (await ensurePushRow(trx, file, "pending")) filesQueued += 1;
            } else {
              await ensurePushRow(
                trx,
                file,
                "excluded",
                policy === "restricted" ? "fee_proposal_pending" : "policy_exclude",
              );
            }
          }
          if (filesQueued > 0) await queuePush(trx, jobId);
          await auditSystem(trx, "teams.folders_provisioned", jobId, "job_teams_link", jobId, {
            folders_created: { from: null, to: resolver.createdPaths.length + createdRoot },
            files_queued: { from: null, to: filesQueued },
          });
        });
        const foldersCreated = resolver.createdPaths.length + createdRoot;
        ctx.log.info({ event: "teams_provisioned", jobId, foldersCreated, filesQueued }, "Teams folders provisioned");
        return { status: "ready", foldersCreated, filesQueued, errorCode: null };
      } catch (error) {
        if (signal.aborted) throw error;
        const code = linkErrorCode(error);
        ctx.log.warn({ event: "teams_provision_failed", jobId, code }, "Teams folders could not be provisioned");
        if (code === "graph_unavailable") {
          // leave the link provisioning; the queue retries with back-off and the sweep after that
          throw new TaskError("graph_unavailable", "Teams did not answer.", { retryable: true, cause: error });
        }
        await markLinkError(db, jobId, code);
        return { status: "error", foldersCreated: 0, filesQueued: 0, errorCode: code };
      }
    },
  };
}
