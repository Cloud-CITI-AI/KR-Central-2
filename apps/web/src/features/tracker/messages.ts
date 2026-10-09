/** Tracker texts that are not in the prototype (PRODUCT_SPEC §5.1 gives the others verbatim). Australian English. */
const LOAD_FAILED = "This job couldn't be loaded. Reload the page and try again.";
const OFFLINE =
  "Can't reach the server – check your connection. What you see may be out of date, and changes can't be saved.";

/** The banner for a failed load or refresh, with the request id when there is one (EH-1). */
export function loadFailedText(requestId: string | undefined): string {
  return requestId ? `${LOAD_FAILED} (Request ID: ${requestId})` : LOAD_FAILED;
}

export const TRACKER_MESSAGES = {
  offline: OFFLINE,
  saveAsPdfTitle: "Saves exactly what is showing – use Expand all first to include everything",
} as const;

/** Job details form (§5.1): the duplicate text is the spec's; the required-field texts are additions. */
export const JOB_DETAILS_MESSAGES = { jobNumber: "Enter the job number.", address: "Enter the address." } as const;

export function duplicateJobText(jobNumber: string): string {
  return `${jobNumber} is already in use.`;
}
