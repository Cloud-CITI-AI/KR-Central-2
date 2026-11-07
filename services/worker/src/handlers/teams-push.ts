/**
 * teams.push (ADR-0015 decisions 7, 8 and 9): copies the job's due files (pending, or failed under the attempt limit)
 * into their folders in the linked channel, one at a time. Each copy records `uploading` with the remote name before
 * the upload and `pushed` with the drive item id, eTag and path after it; a re-run after a crash adopts an item of
 * that name when it is the app's own and the size matches, else takes the next " (n)" name. conflictBehavior=fail
 * means an existing item is never overwritten. Files up to 4 MiB are one PUT; larger ones go in 10 MiB chunks read
 * from the bucket by range. Throttling and outages stop the batch and requeue the operation; a per-file refusal marks
 * that row failed and continues. With copying off or the link not ready it completes as a no-op.
 */
import type { TeamsPushResult } from "@kr/contracts";
import type { Db, TeamsFilePushRow } from "@kr/db";
import { ObjectNotFoundError, type ObjectStorage } from "@kr/storage";
import type { KrMetrics } from "@kr/telemetry";
import type { Clock } from "../clock.js";
import type { WorkerConfig } from "../config.js";
import {
  GraphError,
  SIMPLE_UPLOAD_MAX_BYTES,
  UPLOAD_CHUNK_BYTES,
  type DriveItem,
  type GraphDriveClient,
} from "../clients/graph-drive.js";
import { GraphTokenError } from "../clients/graph-token.js";
import {
  FEE_FOLDER_KEY,
  auditSystem,
  findLink,
  findPushFile,
  isJobArchived,
  jobNumberOf,
  listConditions,
  listDuePushes,
  readFolders,
  reviveFeeRows,
  saveFolder,
  touchLinkPush,
  updatePush,
  type PushFile,
} from "../data/teams.js";
import { readTeamsSettings } from "../data/teams-settings.js";
import { safeName } from "@kr/workflow";
import { pathTooLong, remoteNameFor, sharePointSafe, targetFolderFor, uniqueName } from "../domain/teams-layout.js";
import { adoptable, pushDecision } from "../domain/teams-policy.js";
import { TaskError } from "../errors.js";
import type { FeatureFlags } from "../flags.js";
import { FolderResolver } from "./teams-provision.js";
import { jobIdOf, type Handler, type HandlerContext } from "./types.js";

/** The private channel's name (ADR-0015 decision 10): its folder in its own site's library holds the job subfolders. */
export const FEE_CHANNEL_NAME = "Fee Proposals";
/** Failed copies are retried by the sweep this many times before the row stays failed for a person to look at. */
export const PUSH_MAX_ATTEMPTS = 5;

export interface TeamsPushDeps {
  readonly db: Db;
  readonly storage: ObjectStorage;
  readonly flags: FeatureFlags;
  readonly clock: Clock;
  readonly metrics: Pick<KrMetrics, "recordTeamsPush">;
  readonly config: Pick<WorkerConfig, "TEAMS_GRAPH_TIMEOUT_MS" | "TEAMS_CLIENT_ID">;
  readonly graph?: GraphDriveClient | undefined;
}

async function readAll(storage: ObjectStorage, key: string): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  for await (const chunk of (await storage.get(key)).body) chunks.push(Buffer.from(chunk as Uint8Array));
  return Buffer.concat(chunks);
}

async function readRange(storage: ObjectStorage, key: string, start: number, end: number): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  for await (const chunk of (await storage.get(key, { start, end })).body)
    chunks.push(Buffer.from(chunk as Uint8Array));
  return Buffer.concat(chunks);
}

/** The short code stored on a failed row. */
export function pushErrorCode(error: unknown): string {
  if (error instanceof GraphError)
    return error.kind === "graph_error" ? `graph_${error.status ?? "error"}` : error.kind;
  if (error instanceof GraphTokenError) return "permission_denied";
  if (error instanceof ObjectNotFoundError) return "object_missing";
  return "push_failed";
}

function unavailable(error: unknown): boolean {
  return (
    (error instanceof GraphError && error.unavailable) ||
    (error instanceof GraphTokenError && (error.status === null || error.status >= 500))
  );
}

export function teamsPushHandler(deps: TeamsPushDeps): Handler {
  const { db, storage, flags, clock, metrics } = deps;
  const appId = deps.config.TEAMS_CLIENT_ID ?? "";

  return {
    timeoutMs: Math.max(900_000, deps.config.TEAMS_GRAPH_TIMEOUT_MS * 60),
    async run(ctx: HandlerContext): Promise<TeamsPushResult> {
      const jobId = jobIdOf(ctx.operation);
      const graph = deps.graph;
      const result = { pushed: 0, failed: 0, skipped: 0, deleted: 0 };
      if (!flags.isEnabled("teams-file-sync") || !graph) return result;
      const settings = await readTeamsSettings(db);
      const link = await findLink(db, jobId);
      const jobArchived = await isJobArchived(db, jobId);
      if (settings.fee_proposal_policy === "restricted" && settings.fee_site_url) await reviveFeeRows(db, jobId);
      const due = await listDuePushes(db, jobId, PUSH_MAX_ATTEMPTS);
      if (due.length === 0) return result;
      if (
        !settings.sync_enabled ||
        link?.status !== "ready" ||
        !link.drive_id ||
        !link.root_folder_item_id ||
        jobArchived
      ) {
        return { ...result, skipped: due.length };
      }
      const signal = ctx.signal;
      const driveId = link.drive_id;
      const conditions = await listConditions(db, jobId);
      const known = await readFolders(db, jobId);
      const resolver = new FolderResolver(graph, db, jobId, driveId, link.root_folder_item_id, known, signal);
      /** The job's subfolder in the Fee Proposals channel's library, created on first use (decision 10). */
      let fee: { driveId: string; folderId: string; folderName: string } | null = null;
      async function feeFolder(): Promise<{ driveId: string; folderId: string; folderName: string }> {
        if (fee) return fee;
        if (!graph || !settings.fee_site_url) throw new GraphError("No Fee Proposals site.", 422, "fee_site_missing");
        const site = await graph.siteByUrl(settings.fee_site_url, signal);
        const drive = await graph.defaultDrive(site.id, signal);
        const folderName = sharePointSafe(safeName(await jobNumberOf(db, jobId)));
        let folderId = known.get(FEE_FOLDER_KEY) ?? null;
        if (folderId && !(await graph.item(drive.id, folderId, signal))) folderId = null;
        if (!folderId) {
          // A private channel's files live under its own folder in its site's library; fall back to the library root.
          const parent =
            (await graph.itemByPath(drive.id, FEE_CHANNEL_NAME, signal)) ?? (await graph.root(drive.id, signal));
          const existing = (await graph.children(drive.id, parent.id, signal)).find(
            (c) => c.isFolder && c.name.toLowerCase() === folderName.toLowerCase(),
          );
          folderId = (existing ?? (await graph.createFolder(drive.id, parent.id, folderName, signal))).id;
          await saveFolder(db, jobId, FEE_FOLDER_KEY, folderId);
          known.set(FEE_FOLDER_KEY, folderId);
        }
        fee = { driveId: drive.id, folderId, folderName };
        return fee;
      }

      for (const row of due) {
        // Phase 2 (A4): an app delete removes the copy in Teams, only while its eTag still matches.
        if (row.status === "deleting") {
          await deleteOne(row);
          continue;
        }
        const file = await findPushFile(db, row.file_id);
        if (!file) {
          await updatePush(
            db,
            row.file_id,
            { status: "failed", error_code: "file_gone", attempts: row.attempts + 1 },
            clock.now(),
          );
          result.skipped += 1;
          continue;
        }
        const decision = pushDecision({ file, link, settings, jobArchived });
        if (!decision.push) {
          if (decision.reason === "policy_exclude" || decision.reason === "fee_site_missing") {
            const code = decision.reason === "policy_exclude" ? "policy_exclude" : "fee_proposal_pending";
            await updatePush(db, file.id, { status: "excluded", error_code: code }, clock.now());
            metrics.recordTeamsPush("excluded");
          } else if (decision.reason === "file_removed" || decision.reason === "not_clean") {
            await updatePush(db, file.id, { status: "excluded", error_code: decision.reason }, clock.now());
          }
          result.skipped += 1;
          continue;
        }
        try {
          const item = await pushOne(file, row, decision.target);
          await db.transaction().execute(async (trx) => {
            await updatePush(
              trx,
              file.id,
              {
                status: "pushed",
                drive_item_id: item.item.id,
                etag: item.item.eTag,
                remote_name: item.item.name,
                remote_path: item.path,
                size_bytes: file.size_bytes,
                pushed_at: clock.now(),
                error_code: null,
                attempts: row.attempts + 1,
              },
              clock.now(),
            );
            await auditSystem(trx, "file.teams_pushed", jobId, "file", file.id, {
              remote_path: { from: null, to: item.path },
            });
            await touchLinkPush(trx, jobId, clock.now());
          });
          metrics.recordTeamsPush(item.adopted ? "adopted" : "pushed");
          result.pushed += 1;
        } catch (error) {
          if (signal.aborted) throw error;
          const code = pushErrorCode(error);
          ctx.log.warn(
            { event: "teams_push_failed", jobId, fileId: file.id, code },
            "A file could not be copied to Teams",
          );
          await updatePush(
            db,
            file.id,
            { status: "failed", error_code: code, attempts: row.attempts + 1 },
            clock.now(),
          );
          metrics.recordTeamsPush("failed");
          result.failed += 1;
          if (unavailable(error)) {
            // stop the batch: the queue retries with back-off, and the hourly sweep after that
            throw new TaskError("graph_unavailable", "Teams did not answer. Copying will be tried again.", {
              retryable: true,
              cause: error,
            });
          }
        }
      }
      ctx.log.info({ event: "teams_push_finished", jobId, ...result }, "Teams push finished");
      return result;

      /** Removes the item of a deleted file; a changed eTag leaves it and marks the row `etag_changed`. */
      async function deleteOne(row: TeamsFilePushRow): Promise<void> {
        if (!graph || !row.drive_item_id) {
          await updatePush(db, row.file_id, { status: "deleted", error_code: "no_item" }, clock.now());
          return;
        }
        const targetDrive = row.remote_path?.startsWith("Fee Proposals/") ? (await feeFolder()).driveId : driveId;
        try {
          await graph.deleteItem(targetDrive, row.drive_item_id, row.etag, signal);
          await db.transaction().execute(async (trx) => {
            await updatePush(trx, row.file_id, { status: "deleted", error_code: null }, clock.now());
            await auditSystem(trx, "file.teams_deleted", jobId, "file", row.file_id, {
              remote_path: { from: row.remote_path, to: null },
            });
          });
          result.deleted += 1;
        } catch (error) {
          if (signal.aborted) throw error;
          if (error instanceof GraphError && (error.status === 412 || error.status === 404)) {
            // changed in Teams (412): left alone and shown as such; already gone (404): nothing to do
            await updatePush(
              db,
              row.file_id,
              error.status === 412
                ? { status: "pushed", error_code: "etag_changed" }
                : { status: "deleted", error_code: null },
              clock.now(),
            );
            return;
          }
          const code = pushErrorCode(error);
          await updatePush(
            db,
            row.file_id,
            { status: "deleting", error_code: code, attempts: row.attempts + 1 },
            clock.now(),
          );
          result.failed += 1;
          if (unavailable(error)) {
            throw new TaskError("graph_unavailable", "Teams did not answer. Copying will be tried again.", {
              retryable: true,
              cause: error,
            });
          }
        }
      }

      /** Copies one file; returns the drive item and its path under the root folder. */
      async function pushOne(
        file: PushFile,
        row: TeamsFilePushRow,
        target: "channel" | "fee",
      ): Promise<{ item: DriveItem; path: string; adopted: boolean }> {
        if (!graph) throw new TaskError("teams_not_configured", "The Teams integration is not enabled on the worker.");
        let folder: string;
        let folderId: string;
        let targetDrive = driveId;
        if (target === "fee") {
          // Fee proposal (1.0) files go only to the job's subfolder in the private Fee Proposals channel (decision 10).
          const f = await feeFolder();
          folder = `Fee Proposals/${f.folderName}`;
          folderId = f.folderId;
          targetDrive = f.driveId;
        } else {
          const path = targetFolderFor(
            { checkpointKey: file.checkpoint_key, conditionId: file.condition_id, kind: file.kind },
            conditions,
          );
          if (path === null) throw new GraphError("No folder for this file.", 422, "no_target_folder");
          folder = path;
          folderId = await resolver.resolve(folder);
        }
        const siblings = await graph.children(targetDrive, folderId, signal);
        const sizeBytes = Number(file.size_bytes);
        const baseName = remoteNameFor(file.original_name, file.kind, file.content_type);
        // A half-finished earlier run (row left `uploading` or failed after the upload): adopt the item it left when it
        // is ours and whole (decision 8); otherwise the next free name is taken and that item is left alone.
        if (row.remote_name) {
          const left = siblings.find((s) => s.name.toLowerCase() === row.remote_name?.toLowerCase());
          if (left && adoptable(left, { sizeBytes, appId }))
            return { item: left, path: `${folder}/${left.name}`, adopted: true };
        }
        const name = uniqueName(
          siblings.map((s) => s.name),
          baseName,
        );
        if (pathTooLong(settings.root_folder, folder, name))
          throw new GraphError("Path too long.", 422, "path_too_long");
        await updatePush(
          db,
          file.id,
          { status: "uploading", remote_name: name, remote_path: `${folder}/${name}` },
          clock.now(),
        );
        let item: DriveItem;
        if (sizeBytes <= SIMPLE_UPLOAD_MAX_BYTES) {
          item = await graph.uploadSmall(targetDrive, folderId, name, await readAll(storage, file.storage_key), signal);
        } else {
          const session = await graph.createUploadSession(targetDrive, folderId, name, signal);
          let finished: DriveItem | null = null;
          for (let offset = 0; offset < sizeBytes; offset += UPLOAD_CHUNK_BYTES) {
            const end = Math.min(sizeBytes, offset + UPLOAD_CHUNK_BYTES) - 1;
            const chunk = await readRange(storage, file.storage_key, offset, end);
            finished = await graph.uploadChunk(session, chunk, offset, sizeBytes, signal);
          }
          if (!finished) throw new GraphError("The upload session ended without an item.", null, "upload_incomplete");
          item = finished;
        }
        return { item, path: `${folder}/${item.name}`, adopted: false };
      }
    },
  };
}
