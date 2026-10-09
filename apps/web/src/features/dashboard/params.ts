import { JobStatusFilter, SubdivisionType as SubdivisionTypeSchema } from "@kr/contracts";
import type { SubdivisionType } from "@kr/workflow";
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

/** Parse the query string; anything invalid falls back to the default (the URL is external input, A4). */
export function parseDashboardParams(search: Search): DashboardParams {
  const status = JobStatusFilter.safeParse(search.get("status"));
  const type = SubdivisionTypeSchema.safeParse(search.get("type"));
  return {
    status: status.success ? status.data : "in_progress",
    type: type.success ? type.data : "",
    q: (search.get("q") ?? "").slice(0, 100),
    archived: (search.get("archived") ?? "").slice(0, 32),
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
