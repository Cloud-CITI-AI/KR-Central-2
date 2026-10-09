/**
 * Object keys in the backup bucket (ADR-0008). Pure: the caller supplies the time, nothing here reads a clock.
 *
 *   db/pre-migrate/<utc>-<release>.dump   written by `migrate` before it applies pending migrations
 *   db/nightly/<utc>.dump                 written by `backup`
 *   objects/<files-bucket key>            incremental copy of the files bucket
 *   manifest.json                         which source objects the copies in objects/ came from
 */
export const PRE_MIGRATE_PREFIX = "db/pre-migrate/";
export const NIGHTLY_PREFIX = "db/nightly/";
export const OBJECTS_PREFIX = "objects/";
export const MANIFEST_KEY = "manifest.json";

/** `2026-10-09T07:01:02.345Z` becomes `20261009T070102Z`: sortable and safe in an object key. */
export function utcStamp(at: Date): string {
  return at
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z")
    .replaceAll(/[-:]/g, "");
}

const STAMP = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z/;

/** The time encoded at the start of a dump's file name, or undefined when the key is not one of ours. */
export function stampOfKey(key: string): Date | undefined {
  const name = key.slice(key.lastIndexOf("/") + 1);
  const m = STAMP.exec(name);
  if (!m) return undefined;
  const [, y, mo, d, h, mi, s] = m;
  const at = new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}Z`);
  return Number.isNaN(at.getTime()) ? undefined : at;
}

/** Release labels come from CI tags; keep only characters that are safe in a key. */
export function safeRelease(release: string): string {
  const cleaned = release.replaceAll(/[^A-Za-z0-9._-]/g, "_").slice(0, 64);
  return cleaned === "" ? "unknown" : cleaned;
}

export function preMigrateKey(at: Date, release: string): string {
  return `${PRE_MIGRATE_PREFIX}${utcStamp(at)}-${safeRelease(release)}.dump`;
}

export function nightlyKey(at: Date): string {
  return `${NIGHTLY_PREFIX}${utcStamp(at)}.dump`;
}
