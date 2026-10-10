import { SUBDIVISION_TYPES, type SubdivisionType } from "@kr/workflow";
import type { DashboardStatus } from "./types";

/** Dashboard filters as they live in the URL (§6): `?status=complete&type=Freehold&q=…&archived=S-0001`. */
export interface DashboardParams {
  readonly status: DashboardStatus;
  /** Empty = all types. */
  readonly type: SubdivisionType | "";
  readonly q: string;
  /** Job number of a job archived from its tracker (§5.1): shows the archived banner. */
  readonly archived: string;
}

type Search = Pick<URLSearchParams, "get" | "toString">;

/**
 * The same rules as the contract's `JobStatusFilter`, `SubdivisionType` and job number (`CreateJobRequest.jobNumber`),
 * written out so the dashboard's first render does not load Zod; params.test.ts compares them with the schemas.
 */
export const DASHBOARD_STATUSES = ["in_progress", "complete", "all"] as const satisfies readonly DashboardStatus[];
const JOB_NUMBER = /^[A-Za-z0-9][A-Za-z0-9 ./-]*$/;
const JOB_NUMBER_MAX = 32;

/** Parse the query string; anything invalid falls back to the default (the URL is external input, A4). */
export function parseDashboardParams(search: Search): DashboardParams {
  const status = DASHBOARD_STATUSES.find((value) => value === search.get("status"));
  const type = SUBDIVISION_TYPES.find((value) => value === search.get("type"));
  // The banner quotes this text, so only a real job number (trimmed, as the contract does) gets through; anything else fails closed.
  const archived = (search.get("archived") ?? "").trim();
  const validArchived = archived.length > 0 && archived.length <= JOB_NUMBER_MAX && JOB_NUMBER.test(archived);
  return {
    status: status ?? "in_progress",
    type: type ?? "",
    q: (search.get("q") ?? "").slice(0, 100),
    archived: validArchived ? archived : "",
  };
}

/** The URL after changing some filters. Defaults are left out; unrelated parameters are kept. */
export function dashboardHref(pathname: string, search: Search, patch: Partial<DashboardParams>): string {
  const next = { ...parseDashboardParams(search), ...patch };
  const query = new URLSearchParams(search.toString());
  const set = (key: string, value: string, fallback = "") => {
    if (value && value !== fallback) query.set(key, value);
    else query.delete(key);
  };
  set("status", next.status, "in_progress");
  set("type", next.type);
  set("q", next.q.trim());
  set("archived", next.archived);
  const text = query.toString();
  return text ? `${pathname}?${text}` : pathname;
}
