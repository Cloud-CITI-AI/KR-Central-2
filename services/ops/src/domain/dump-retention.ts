/**
 * Which database dumps to delete (ADR-0008: 35 days by default). Dump keys carry their UTC time (see keys.ts), so age
 * comes from the name, not from the bucket's clock. Every prefix keeps its newest dump however old it is, so a long
 * outage of the backup job can never prune the last recovery point away.
 */
import { stampOfKey } from "./keys.js";

const DAY_MS = 86_400_000;

export interface PruningPlan {
  readonly delete: readonly string[];
  /** Keys whose name does not start with a UTC stamp: left alone, reported. */
  readonly unrecognised: readonly string[];
}

export function planDumpPruning(keys: readonly string[], now: Date, retentionDays: number): PruningPlan {
  const cutoff = now.getTime() - retentionDays * DAY_MS;
  const byPrefix = new Map<string, { key: string; at: number }[]>();
  const unrecognised: string[] = [];
  for (const key of keys) {
    const at = stampOfKey(key)?.getTime();
    if (at === undefined) {
      unrecognised.push(key);
      continue;
    }
    const prefix = key.slice(0, key.lastIndexOf("/") + 1);
    byPrefix.set(prefix, [...(byPrefix.get(prefix) ?? []), { key, at }]);
  }
  const doomed: string[] = [];
  for (const dumps of byPrefix.values()) {
    const [newest, ...older] = [...dumps].sort((a, b) => b.at - a.at);
    if (newest === undefined) continue;
    for (const dump of older) if (dump.at < cutoff) doomed.push(dump.key);
  }
  return { delete: doomed.sort(), unrecognised };
}
