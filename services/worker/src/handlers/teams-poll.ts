/**
 * teams.poll (ADR-0015 A4, phase 2): reads what changed under a linked job's root folder with Graph delta and applies
 * it. A new file in a known folder is downloaded, classified and inserted like an upload (scan queued, source `teams`);
 * one in an unknown place goes on the Unfiled list; an item the app pushed that changed in Teams replaces the app's
 * file (the old row soft-deleted as `teams_replaced`); one deleted in Teams marks the file "Removed in Teams". A payload
 * `{ import: { itemId, checkpointKey, slot | conditionId } }` imports exactly that item (the Unfiled list's FILE).
 * Off (inbound switch, flag, no ready link) it completes as a no-op. Idempotent per item through eTags.
 */
import type { TeamsPollResult } from "@kr/contracts";
import type { Db } from "@kr/db";
import { classifyContent, SNIFF_BYTES, sanitiseFileName, type ObjectStorage } from "@kr/storage";
import { z } from "zod";
import type { Clock } from "../clock.js";
import type { WorkerConfig } from "../config.js";
import { GraphError, type DeltaItem, type GraphDriveClient } from "../clients/graph-drive.js";
import { auditSystem, findLink, isJobArchived, listConditions } from "../data/teams.js";
import {
  fileTargetOf,
  findInbound,
  insertImportedFile,
  markFileRemovedInTeams,
  markInbound,
  ownItems,
  queueScan,
  recordAsPushed,
  recordedItems,
  retireReplacedFile,
  savePollState,
  upsertInbound,
} from "../data/teams-inbound.js";
import { readTeamsSettings } from "../data/teams-settings.js";
import { classifyInbound, relativeFolder, slotFor, type ImportTarget } from "../domain/teams-inbound.js";
import { TaskError } from "../errors.js";
import type { FeatureFlags } from "../flags.js";
import { jobIdOf, type Handler, type HandlerContext } from "./types.js";

const Payload = z.object({
  import: z
    .object({
      itemId: z.string().min(1).max(200),
      checkpointKey: z.string().optional(),
      slot: z.string().optional(),
      conditionId: z.uuid().optional(),
    })
    .optional(),
});

export interface TeamsPollDeps {
  readonly db: Db;
  readonly storage: ObjectStorage;
  readonly flags: FeatureFlags;
  readonly clock: Clock;
  readonly config: Pick<WorkerConfig, "TEAMS_GRAPH_TIMEOUT_MS" | "UPLOAD_MAX_BYTES">;
  readonly graph?: GraphDriveClient | undefined;
}

const skipped = (): TeamsPollResult => ({ imported: 0, unfiled: 0, replaced: 0, removed: 0, failed: 0, skipped: true });

export function teamsPollHandler(deps: TeamsPollDeps): Handler {
  const { db, storage, flags, clock } = deps;

  return {
    timeoutMs: Math.max(600_000, deps.config.TEAMS_GRAPH_TIMEOUT_MS * 40),
    async run(ctx: HandlerContext): Promise<TeamsPollResult> {
      const payload = Payload.safeParse(ctx.operation.payload);
      if (!payload.success) throw new TaskError("invalid_payload", "The task was not set up correctly.");
      const jobId = jobIdOf(ctx.operation);
      const graph = deps.graph;
      if (!flags.isEnabled("teams-file-sync") || !graph) return skipped();
      const settings = await readTeamsSettings(db);
      const link = await findLink(db, jobId);
      const explicit = payload.data.import;
      if (!settings.sync_enabled || (!settings.inbound_sync_enabled && !explicit)) return skipped();
      if (link?.status !== "ready" || !link.drive_id || !link.root_folder_item_id || (await isJobArchived(db, jobId))) {
        return skipped();
      }
      const driveId = link.drive_id;
      const signal = ctx.signal;
      const result = { imported: 0, unfiled: 0, replaced: 0, removed: 0, failed: 0, skipped: false };
      const conditions = await listConditions(db, jobId);
      const root = await graph.item(driveId, link.root_folder_item_id, signal);
      if (!root) throw new TaskError("channel_folder_missing", "The channel's folder was not found in Teams.");
      const rootPath = `${root.parentPath ?? ""}/${root.name}`;

      /** Downloads and files one item; returns false (and records why) when it cannot be imported. */
      async function importItem(
        item: DeltaItem,
        target: ImportTarget,
        relativePath: string,
        requestedSlot: string | null,
      ): Promise<boolean> {
        const remotePath = relativePath ? `${relativePath}/${item.name}` : item.name;
        const size = item.size ?? 0;
        const base = {
          jobId,
          itemId: item.id,
          remotePath,
          name: item.name,
          sizeBytes: item.size,
          eTag: item.eTag,
          modifiedByName: item.lastModifiedByName,
          modifiedAt: item.lastModifiedAt ? new Date(item.lastModifiedAt) : null,
        };
        if (size > deps.config.UPLOAD_MAX_BYTES) {
          await upsertInbound(db, { ...base, status: "unfiled", errorCode: "too_large" }, clock.now());
          return false;
        }
        if (!graph) return false;
        const bytes = await graph.download(driveId, item.id, deps.config.UPLOAD_MAX_BYTES, signal);
        const name = sanitiseFileName(item.name);
        const classified = await classifyContent(bytes.subarray(0, SNIFF_BYTES), name);
        if ("rejected" in classified) {
          await upsertInbound(db, { ...base, status: "unfiled", errorCode: "kind_not_accepted" }, clock.now());
          return false;
        }
        const kind = classified.kind;
        let placement: { checkpointKey: string | null; slot: string | null; conditionId: string | null };
        if (target.kind === "condition") {
          if (!conditions.some((c) => c.id === target.conditionId)) {
            await upsertInbound(db, { ...base, status: "unfiled", errorCode: "condition_gone" }, clock.now());
            return false;
          }
          placement = { checkpointKey: null, slot: null, conditionId: target.conditionId };
        } else {
          const slot = slotFor(target.checkpointKey, kind, requestedSlot, target.emailsOnly);
          if (slot === null) {
            await upsertInbound(db, { ...base, status: "unfiled", errorCode: "kind_not_accepted" }, clock.now());
            return false;
          }
          placement = { checkpointKey: target.checkpointKey, slot, conditionId: null };
        }
        await db.transaction().execute(async (trx) => {
          const file = await insertImportedFile(trx, {
            jobId,
            ...placement,
            name,
            kind,
            contentType: classified.contentType,
            bytes,
          });
          await storage.put({ key: file.storageKey, body: bytes, contentType: classified.contentType });
          await queueScan(trx, jobId, file.id);
          await recordAsPushed(
            trx,
            {
              jobId,
              fileId: file.id,
              itemId: item.id,
              eTag: item.eTag,
              name: item.name,
              remotePath,
              sizeBytes: bytes.byteLength,
            },
            clock.now(),
          );
          await upsertInbound(trx, { ...base, status: "imported", fileId: file.id }, clock.now());
          await auditSystem(trx, "file.teams_imported", jobId, "file", file.id, {
            remote_path: { from: null, to: remotePath },
            added_by: { from: null, to: item.lastModifiedByName },
          });
        });
        return true;
      }

      // An explicit filing from the Unfiled list: exactly that item, into the chosen place.
      if (explicit) {
        const item = await graph.item(driveId, explicit.itemId, signal);
        const recorded = await findInbound(db, jobId, explicit.itemId);
        if (!item || item.isFolder) {
          if (recorded) await markInbound(db, jobId, explicit.itemId, "removed", clock.now());
          return { ...result, failed: 1 };
        }
        const relative = relativeFolder(item.parentPath, rootPath) ?? "";
        const target: ImportTarget = explicit.conditionId
          ? { kind: "condition", conditionId: explicit.conditionId }
          : { kind: "checkpoint", checkpointKey: explicit.checkpointKey ?? "", emailsOnly: false };
        const ok = await importItem(
          { ...item, deleted: false, lastModifiedByName: null, lastModifiedAt: null },
          target,
          relative,
          explicit.slot ?? null,
        );
        return ok ? { ...result, imported: 1 } : { ...result, failed: 1 };
      }

      const page = await graph.delta(driveId, link.root_folder_item_id, link.delta_token, signal);
      const actions = classifyInbound(page.items, {
        rootPath,
        own: await ownItems(db, jobId),
        recorded: await recordedItems(db, jobId),
        conditions,
      });
      for (const a of actions) {
        try {
          switch (a.action) {
            case "ignore":
              break;
            case "unfiled": {
              await upsertInbound(
                db,
                {
                  jobId,
                  itemId: a.item.id,
                  remotePath: a.relativePath ? `${a.relativePath}/${a.item.name}` : a.item.name,
                  name: a.item.name,
                  sizeBytes: a.item.size,
                  eTag: a.item.eTag,
                  modifiedByName: a.item.lastModifiedByName,
                  modifiedAt: a.item.lastModifiedAt ? new Date(a.item.lastModifiedAt) : null,
                  status: "unfiled",
                },
                clock.now(),
              );
              result.unfiled += 1;
              break;
            }
            case "import": {
              if (await importItem(a.item, a.target, a.relativePath, null)) result.imported += 1;
              else result.unfiled += 1;
              break;
            }
            case "replaced": {
              const old = await fileTargetOf(db, a.own.fileId);
              if (!old) break;
              const target: ImportTarget = old.condition_id
                ? { kind: "condition", conditionId: old.condition_id }
                : { kind: "checkpoint", checkpointKey: old.checkpoint_key ?? "", emailsOnly: false };
              const relative = relativeFolder(a.item.parentPath, rootPath) ?? "";
              await db.transaction().execute((trx) => retireReplacedFile(trx, a.own.fileId, clock.now()));
              if (await importItem(a.item, target, relative, old.slot)) {
                await db.transaction().execute((trx) =>
                  auditSystem(trx, "file.teams_replaced", jobId, "file", a.own.fileId, {
                    replaced_by_item: { from: null, to: a.item.id },
                  }),
                );
                result.replaced += 1;
              } else result.unfiled += 1;
              break;
            }
            case "removed": {
              await db.transaction().execute(async (trx) => {
                await markFileRemovedInTeams(trx, a.own.fileId, clock.now());
                await auditSystem(trx, "file.teams_removed", jobId, "file", a.own.fileId);
              });
              result.removed += 1;
              break;
            }
            case "inbound_removed": {
              await markInbound(db, jobId, a.item.id, "removed", clock.now());
              break;
            }
          }
        } catch (error) {
          if (signal.aborted) throw error;
          if (error instanceof GraphError && error.unavailable) {
            throw new TaskError("graph_unavailable", "Teams did not answer. It will be tried again.", {
              retryable: true,
              cause: error,
            });
          }
          ctx.log.warn(
            {
              event: "teams_inbound_failed",
              jobId,
              itemId: a.item.id,
              code: error instanceof GraphError ? error.display : "error",
            },
            "An item added in Teams could not be brought in",
          );
          await upsertInbound(
            db,
            {
              jobId,
              itemId: a.item.id,
              remotePath: a.item.name,
              name: a.item.name,
              sizeBytes: a.item.size,
              eTag: a.item.eTag,
              modifiedByName: a.item.lastModifiedByName,
              modifiedAt: null,
              status: "failed",
              errorCode: error instanceof GraphError ? error.kind : "import_failed",
            },
            clock.now(),
          );
          result.failed += 1;
        }
      }
      await savePollState(db, jobId, page.token, clock.now());
      ctx.log.info(
        { event: "teams_poll_finished", jobId, ...result, resynced: page.resynced },
        "Teams inbound check finished",
      );
      return result;
    },
  };
}
