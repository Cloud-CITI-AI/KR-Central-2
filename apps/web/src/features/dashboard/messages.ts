import { ApiProblem } from "@/lib/api/problem";

/** Dashboard texts that are not in the prototype (PRODUCT_SPEC §6 gives the rest verbatim). Australian English. */
const LOAD_FAILED = "The dashboard couldn't be loaded. Reload the page and try again.";
const REFRESH_FAILED =
  "The dashboard couldn't be refreshed, so what you see may be out of date. Reload the page and try again.";
/** The connectivity banner of §5.1, as the tracker words it. */
const OFFLINE = "Can't reach the server – check your connection.";
const OUT_OF_DATE = " What you see may be out of date.";

/**
 * The one banner for a failed dashboard request (§5.1, §12): connectivity wording when nothing came back (status 0), the
 * request id when the API answered, and "may be out of date" when the cards or counts on screen are cached ones.
 * `error` is the first failed query's error.
 */
export function dashboardFailureText(error: unknown, showingCachedData: boolean): string {
  const problem = error instanceof ApiProblem ? error : undefined;
  if (problem?.status === 0) return showingCachedData ? `${OFFLINE}${OUT_OF_DATE}` : OFFLINE;
  const requestId = problem?.requestId;
  const text = showingCachedData ? REFRESH_FAILED : LOAD_FAILED;
  return requestId ? `${text} (Request ID: ${requestId})` : text;
}

/** After a job is archived from its tracker (§5.1): "S-0001 was archived.". */
export function archivedText(jobNumber: string): string {
  return `${jobNumber} was archived.`;
}

export const GRID_MESSAGES = {
  noMatch: "No jobs match.",
  /** An external user with no active grants (§3.4). */
  noAccess: "You don't have access to any jobs yet — ask your KR Surveys contact.",
  loadMore: "Load more",
  loading: "Loading jobs…",
} as const;

/** NEW JOB form (§6). The duplicate text is the spec's; the required-field and failure texts are additions. */
export const NEW_JOB_MESSAGES = {
  jobNumber: "Enter the job number.",
  address: "Enter the address.",
  subdivisionType: "Choose the subdivision type.",
} as const;

export function duplicateJobText(jobNumber: string): string {
  return `${jobNumber} is already in use.`;
}

export function saveFailedJobText(requestId: string | undefined): string {
  const text = "That couldn't be saved. Try again.";
  return requestId ? `${text} (Request ID: ${requestId})` : text;
}
