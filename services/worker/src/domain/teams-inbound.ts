/**
 * What to do with each change Graph reports under a linked job's root folder (ADR-0015 A4). Pure.
 * - an item the app pushed itself: ignored while its eTag is unchanged, `replaced` when it changed, `removed` when a
 *   tombstone arrives;
 * - any other file: `import` when it sits in a folder the layout knows (a checkpoint, its Query emails subfolder,
 *   or a condition-evidence folder), else `unfiled`; ignored when nothing changed since it was last recorded;
 * - folders are never imported; items outside the root folder never reach this function.
 */
import { STAGES, checkpointFolderName, conditionEvidenceFolderName, slotsOf, stageFolderName } from "@kr/workflow";
import type { DeltaItem } from "../clients/graph-drive.js";
import { sharePointSafePath } from "./teams-layout.js";

export interface OwnItem {
  readonly fileId: string;
  readonly eTag: string | null;
}

export interface InboundRecord {
  readonly status: "seen" | "importing" | "imported" | "unfiled" | "dismissed" | "failed" | "removed";
  readonly eTag: string | null;
}

export type ImportTarget =
  | { readonly kind: "checkpoint"; readonly checkpointKey: string; readonly emailsOnly: boolean }
  | { readonly kind: "condition"; readonly conditionId: string };

export type InboundAction =
  | { readonly action: "ignore"; readonly item: DeltaItem }
  | { readonly action: "removed"; readonly item: DeltaItem; readonly own: OwnItem }
  | { readonly action: "inbound_removed"; readonly item: DeltaItem }
  | { readonly action: "replaced"; readonly item: DeltaItem; readonly own: OwnItem }
  | {
      readonly action: "import";
      readonly item: DeltaItem;
      readonly target: ImportTarget;
      readonly relativePath: string;
    }
  | { readonly action: "unfiled"; readonly item: DeltaItem; readonly relativePath: string };

export interface InboundContext {
  /** The root folder's own path under the drive root, e.g. `/S-0042/102. Subdivision Tracker`. */
  readonly rootPath: string;
  /** Items the app pushed, by drive item id. */
  readonly own: ReadonlyMap<string, OwnItem>;
  /** Items already recorded as inbound, by drive item id. */
  readonly recorded: ReadonlyMap<string, InboundRecord>;
  /** The job's current conditions. */
  readonly conditions: readonly { id: string; number: number; agency: string }[];
}

/** Folder path (relative to the root folder) → where files in it belong. Evidence folders need the conditions. */
export function layoutIndex(
  conditions: readonly { id: string; number: number; agency: string }[],
): Map<string, ImportTarget> {
  const index = new Map<string, ImportTarget>();
  for (const stage of STAGES) {
    for (const checkpoint of stage.checkpoints) {
      if (checkpoint.restricted === "fee_proposal") continue;
      const base = sharePointSafePath(checkpointFolderName(stage.key, checkpoint.number, checkpoint.title, false));
      index.set(base, { kind: "checkpoint", checkpointKey: checkpoint.key, emailsOnly: false });
      if (slotsOf(checkpoint).some((s) => s.accept.includes("email"))) {
        index.set(`${base}/Query emails`, { kind: "checkpoint", checkpointKey: checkpoint.key, emailsOnly: true });
      }
    }
    if (stage.agency) {
      for (const condition of conditions.filter((c) => c.agency === stage.agency)) {
        index.set(sharePointSafePath(conditionEvidenceFolderName(stage.key, condition.number)), {
          kind: "condition",
          conditionId: condition.id,
        });
      }
    }
    sharePointSafePath(stageFolderName(stage.key)); // stage folders themselves hold no files worth importing
  }
  return index;
}

/** The folder path relative to the root folder, or null when the item is not under it. */
export function relativeFolder(parentPath: string | null, rootPath: string): string | null {
  if (parentPath === null) return null;
  const root = rootPath.replace(/\/+$/, "");
  if (parentPath === root) return "";
  if (!parentPath.startsWith(`${root}/`)) return null;
  return parentPath.slice(root.length + 1);
}

export function classifyInbound(items: readonly DeltaItem[], ctx: InboundContext): InboundAction[] {
  const index = layoutIndex(ctx.conditions);
  const out: InboundAction[] = [];
  for (const item of items) {
    const own = ctx.own.get(item.id);
    if (item.deleted) {
      if (own) out.push({ action: "removed", item, own });
      else if (ctx.recorded.has(item.id) && ctx.recorded.get(item.id)?.status !== "removed")
        out.push({ action: "inbound_removed", item });
      else out.push({ action: "ignore", item });
      continue;
    }
    if (item.isFolder) {
      out.push({ action: "ignore", item });
      continue;
    }
    if (own) {
      out.push(
        own.eTag !== null && own.eTag === item.eTag ? { action: "ignore", item } : { action: "replaced", item, own },
      );
      continue;
    }
    const recorded = ctx.recorded.get(item.id);
    if (recorded?.eTag === item.eTag && recorded.status !== "seen" && recorded.status !== "removed") {
      out.push({ action: "ignore", item });
      continue;
    }
    const relativePath = relativeFolder(item.parentPath, ctx.rootPath);
    if (relativePath === null) {
      out.push({ action: "ignore", item });
      continue;
    }
    const target = index.get(relativePath);
    out.push(target ? { action: "import", item, target, relativePath } : { action: "unfiled", item, relativePath });
  }
  return out;
}

/** The slot of a checkpoint that takes a file of this kind: the requested one when given, else the first that accepts it. */
export function slotFor(
  checkpointKey: string,
  kind: string,
  requested: string | null,
  emailsOnly: boolean,
): string | null {
  const checkpoint = STAGES.flatMap((s) => s.checkpoints).find((c) => c.key === checkpointKey);
  if (!checkpoint) return null;
  const slots = slotsOf(checkpoint);
  if (emailsOnly && kind !== "email") return null;
  if (requested !== null) {
    const slot = slots.find((s) => s.key === requested);
    return slot?.accept.includes(kind as (typeof slot.accept)[number]) ? slot.key : null;
  }
  return slots.find((s) => s.accept.includes(kind as (typeof s.accept)[number]))?.key ?? null;
}
