/**
 * Planning for the incremental copy of the files bucket into `objects/` of the backup bucket (ADR-0008, PRODUCT_SPEC 17).
 * Pure: the caller lists both buckets and supplies the time; nothing here performs I/O or reads a clock.
 *
 * The manifest remembers, for every source key, the size and etag it was copied at and since when the source has been
 * gone. A copy is kept for BACKUP_RETENTION_DAYS after its source disappeared, then deleted, so a purged file (PRODUCT_SPEC 11:
 * 30 days after removal) does not live on in the backups forever, while a deletion made by mistake can still be recovered.
 */
const DAY_MS = 86_400_000;

export interface SourceObject {
  readonly key: string;
  readonly size: number;
  /** Change token from the listing (S3 ETag without quotes). */
  readonly etag: string;
}

export interface ManifestEntry {
  readonly size: number;
  /** The SOURCE object's etag when it was copied; empty for a copy found without a record. */
  readonly etag: string;
  readonly copiedAt: string;
  /** ISO time the source was first seen missing; null while it exists. */
  readonly missingSince: string | null;
}

export type Manifest = Readonly<Record<string, ManifestEntry>>;

export interface SyncInput {
  readonly source: readonly SourceObject[];
  readonly manifest: Manifest;
  /** Objects found under `objects/` in the backup bucket: source key (prefix removed) to size. */
  readonly copies: ReadonlyMap<string, number>;
  readonly now: Date;
  readonly retentionDays: number;
}

export interface SyncPlan {
  /** Missing, changed or damaged copies to (re)write. */
  readonly copy: readonly SourceObject[];
  /** Sources that are gone and were not yet recorded as gone, with the size of the copy kept. Includes unrecorded copies. */
  readonly newlyMissing: ReadonlyMap<string, number>;
  /** Sources that exist again after having been recorded as gone. */
  readonly reappeared: readonly string[];
  /** Copies whose source has been gone longer than the retention period: delete them. */
  readonly purge: readonly string[];
  /** Recorded as gone, and the copy is already absent: drop the record. */
  readonly forget: readonly string[];
}

export function planObjectSync(input: SyncInput): SyncPlan {
  const { source, manifest, copies, now } = input;
  const cutoff = now.getTime() - input.retentionDays * DAY_MS;
  const present = new Set(source.map((s) => s.key));

  const copy: SourceObject[] = [];
  const reappeared: string[] = [];
  for (const object of source) {
    const entry = manifest[object.key];
    const stale = entry?.size !== object.size || entry.etag !== object.etag || copies.get(object.key) !== object.size;
    if (stale) copy.push(object);
    else if (entry.missingSince !== null) reappeared.push(object.key);
  }

  const newlyMissing = new Map<string, number>();
  const purge: string[] = [];
  const forget: string[] = [];
  for (const [key, entry] of Object.entries(manifest)) {
    if (present.has(key)) continue;
    if (entry.missingSince === null) {
      newlyMissing.set(key, copies.get(key) ?? entry.size);
    } else if (Date.parse(entry.missingSince) < cutoff) {
      if (copies.has(key)) purge.push(key);
      else forget.push(key);
    }
  }
  // A copy with no record whose source is gone (a crash between copy and manifest write): start its retention clock now.
  for (const [key, size] of copies) {
    if (!present.has(key) && manifest[key] === undefined) newlyMissing.set(key, size);
  }
  return { copy, newlyMissing, reappeared, purge, forget };
}

export interface SyncOutcome {
  readonly copied: readonly SourceObject[];
  readonly purged: readonly string[];
}

/** The manifest after a run: what was copied, what went missing or came back, and what was purged or forgotten. */
export function nextManifest(manifest: Manifest, plan: SyncPlan, outcome: SyncOutcome, now: Date): Manifest {
  const at = now.toISOString();
  const removed = new Set([...outcome.purged, ...plan.forget]);
  const next: Record<string, ManifestEntry> = Object.fromEntries(
    Object.entries(manifest).filter(([key]) => !removed.has(key)),
  );
  for (const key of plan.reappeared) {
    const entry = next[key];
    if (entry) next[key] = { ...entry, missingSince: null };
  }
  for (const [key, size] of plan.newlyMissing) {
    const entry = next[key];
    next[key] = entry ? { ...entry, missingSince: at } : { size, etag: "", copiedAt: at, missingSince: at };
  }
  for (const object of outcome.copied) {
    next[object.key] = { size: object.size, etag: object.etag, copiedAt: at, missingSince: null };
  }
  return next;
}
