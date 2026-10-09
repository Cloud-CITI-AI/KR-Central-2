/**
 * Incremental copy of the files bucket into `objects/` of the backup bucket: plan (domain/object-sync.ts), stream what is
 * new or changed, delete copies whose source has been gone longer than the retention period, write the manifest. One
 * failed object does not stop the others: the manifest still records what succeeded, then the run fails and retries next time.
 */
import type { Logger } from "@kr/logger";
import { ObjectNotFoundError, type ObjectStorage } from "@kr/storage";
import { OBJECTS_PREFIX } from "./domain/keys.js";
import { nextManifest, planObjectSync, type SourceObject } from "./domain/object-sync.js";
import type { Clock } from "./migrate-job.js";
import { loadManifest, saveManifest } from "./manifest.js";

const DEFAULT_CONCURRENCY = 4;

export interface ObjectCopyDeps {
  /** The files bucket (read only). */
  readonly source: Pick<ObjectStorage, "list" | "get">;
  /** The backup bucket. */
  readonly backup: Pick<ObjectStorage, "list" | "get" | "put" | "delete">;
  readonly clock: Clock;
  readonly log: Logger;
  readonly retentionDays: number;
  readonly concurrency?: number;
}

export interface ObjectCopyResult {
  readonly copied: number;
  readonly bytes: number;
  readonly vanished: number;
  readonly newlyMissing: number;
  readonly reappeared: number;
  readonly purged: number;
}

export class ObjectCopyError extends Error {
  constructor(readonly failures: readonly string[]) {
    super(`${failures.length} object operation(s) failed: ${failures.slice(0, 3).join("; ")}`);
    this.name = "ObjectCopyError";
  }
}

async function collect<T>(items: AsyncIterable<T>): Promise<T[]> {
  const all: T[] = [];
  for await (const item of items) all.push(item);
  return all;
}

async function forEachLimited<T>(items: readonly T[], limit: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async (): Promise<void> => {
    for (let item = items[next++]; item !== undefined; item = items[next++]) await work(item);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

const describeError = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export async function copyObjects(deps: ObjectCopyDeps): Promise<ObjectCopyResult> {
  const { source, backup, log } = deps;
  const now = deps.clock.now();
  const manifest = await loadManifest(backup);
  const sourceObjects = await collect(source.list(""));
  const copies = new Map(
    (await collect(backup.list(OBJECTS_PREFIX))).map((o) => [o.key.slice(OBJECTS_PREFIX.length), o.size] as const),
  );
  const plan = planObjectSync({ source: sourceObjects, manifest, copies, now, retentionDays: deps.retentionDays });
  log.info(
    {
      event: "ops_backup_objects_planned",
      source: sourceObjects.length,
      copy: plan.copy.length,
      newlyMissing: plan.newlyMissing.size,
      reappeared: plan.reappeared.length,
      purge: plan.purge.length,
    },
    "Object copy planned",
  );

  const failures: string[] = [];
  const copied: SourceObject[] = [];
  let vanished = 0;
  let bytes = 0;
  const limit = deps.concurrency ?? DEFAULT_CONCURRENCY;

  await forEachLimited(plan.copy, limit, async (object) => {
    try {
      const got = await source.get(object.key);
      const stored = await backup
        .put({ key: OBJECTS_PREFIX + object.key, body: got.body, contentType: got.contentType })
        .finally(() => got.body.destroy());
      if (stored.size !== object.size) throw new Error(`copied ${stored.size} bytes, listing said ${object.size}`);
      copied.push(object);
      bytes += stored.size;
    } catch (error) {
      if (error instanceof ObjectNotFoundError) {
        vanished += 1; // deleted between the listing and the read: the next run records it as gone
        return;
      }
      failures.push(`copy ${object.key}: ${describeError(error)}`);
      log.error({ event: "ops_backup_object_failed", key: object.key, err: error }, "Object copy failed");
    }
  });

  const purged: string[] = [];
  await forEachLimited(plan.purge, limit, async (key) => {
    try {
      await backup.delete(OBJECTS_PREFIX + key);
      purged.push(key);
    } catch (error) {
      failures.push(`purge ${key}: ${describeError(error)}`);
      log.error({ event: "ops_backup_purge_failed", key, err: error }, "Purging an expired copy failed");
    }
  });

  await saveManifest(backup, nextManifest(manifest, plan, { copied, purged }, now), now);
  if (failures.length > 0) throw new ObjectCopyError(failures);
  return {
    copied: copied.length,
    bytes,
    vanished,
    newlyMissing: plan.newlyMissing.size,
    reappeared: plan.reappeared.length,
    purged: purged.length,
  };
}
