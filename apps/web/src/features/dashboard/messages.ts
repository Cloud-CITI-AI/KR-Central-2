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
