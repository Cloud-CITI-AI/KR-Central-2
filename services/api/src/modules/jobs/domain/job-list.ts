/**
 * Dashboard list rules: status filter, sort order, cursor pagination, search escaping and facet counts
 * (PRODUCT_SPEC §6). Pure; the progress, alert and "waiting on client" values arrive already computed by @kr/workflow.
 */
import type { JobFacets, JobListQuery } from "@kr/contracts";
import { SUBDIVISION_TYPES, compareJobNumbers } from "@kr/workflow";
import type { z } from "zod";

export type StatusFilter = z.output<typeof JobListQuery>["status"];
export type SortMode = z.output<typeof JobListQuery>["sort"];
type Facets = z.output<typeof JobFacets>;

/** What list ordering, paging and counting need to know about one job. */
export interface ListEntry {
  readonly id: string;
  readonly jobNumber: string;
  readonly subdivisionType: string | null;
  readonly isComplete: boolean;
  readonly isWaitingOnClient: boolean;
  readonly alertCount: number;
}

export function matchesStatus(filter: StatusFilter, entry: Pick<ListEntry, "isComplete">): boolean {
  return filter === "all" || (filter === "complete") === entry.isComplete;
}

/** Escape LIKE/ILIKE wildcards (and the escape character itself) so user text matches literally. */
export function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** The ILIKE pattern for the dashboard search box (substring match). */
export function searchPattern(q: string): string {
  return `%${escapeLike(q.trim())}%`;
}

type Position = Pick<ListEntry, "id" | "jobNumber" | "alertCount">;

/** attention: most alerts first, then natural job number; job_number: natural job number. The id makes it a total order. */
export function compareEntries(sort: SortMode): (a: Position, b: Position) => number {
  return (a, b) =>
    (sort === "attention" ? b.alertCount - a.alertCount : 0) ||
    compareJobNumbers(a.jobNumber, b.jobNumber) ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

interface CursorBody {
  readonly s: SortMode;
  readonly a: number;
  readonly n: string;
  readonly i: string;
}

export function encodeCursor(sort: SortMode, entry: Position): string {
  const body: CursorBody = { s: sort, a: entry.alertCount, n: entry.jobNumber, i: entry.id };
  return Buffer.from(JSON.stringify(body), "utf8").toString("base64url");
}

/** The position a cursor stands for, or null when it is malformed or was issued for a different sort. */
export function decodeCursor(sort: SortMode, raw: string): Position | null {
  let body: unknown;
  try {
    body = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (typeof body !== "object" || body === null) return null;
  const { s, a, n, i } = body as Record<string, unknown>;
  if (s !== sort || typeof a !== "number" || !Number.isInteger(a) || typeof n !== "string" || typeof i !== "string") {
    return null;
  }
  return { alertCount: a, jobNumber: n, id: i };
}

export interface Page<T> {
  readonly items: T[];
  readonly nextCursor: string | null;
}

/** Sort `entries`, drop everything up to and including the cursor position, and take `limit`. */
export function paginate<T extends ListEntry>(
  entries: readonly T[],
  sort: SortMode,
  after: Position | null,
  limit: number,
): Page<T> {
  const compare = compareEntries(sort);
  const sorted = [...entries].sort(compare);
  const rest = after ? sorted.filter((e) => compare(e, after) > 0) : sorted;
  const items = rest.slice(0, limit);
  const last = items.at(-1);
  return { items, nextCursor: rest.length > limit && last ? encodeCursor(sort, last) : null };
}

/**
 * Counts for the dashboard header. `entries` are every job the caller can see. Status counts, "waiting on client" and
 * "need attention" cover all of them (as the prototype's summary chips); type counts are within the status filter,
 * under the key "" for all types.
 */
export function computeFacets(entries: readonly ListEntry[], status: StatusFilter): Facets {
  const inStatus = entries.filter((e) => matchesStatus(status, e));
  const typeCounts: Record<string, number> = { "": inStatus.length };
  for (const type of SUBDIVISION_TYPES) typeCounts[type] = inStatus.filter((e) => e.subdivisionType === type).length;
  return {
    statusCounts: {
      in_progress: entries.filter((e) => !e.isComplete).length,
      complete: entries.filter((e) => e.isComplete).length,
      all: entries.length,
    },
    typeCounts,
    waitingOnClient: entries.filter((e) => e.isWaitingOnClient).length,
    needAttention: entries.filter((e) => e.alertCount > 0).length,
  };
}
