/** Dashboard texts that are not in the prototype (PRODUCT_SPEC §6 gives the rest verbatim). Australian English. */
const LOAD_FAILED = "The dashboard couldn't be loaded. Reload the page and try again.";

/** The load-failure text, with the request id when there is one (EH-1). */
export function loadFailedText(requestId: string | undefined): string {
  return requestId ? `${LOAD_FAILED} (Request ID: ${requestId})` : LOAD_FAILED;
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
