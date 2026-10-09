/** Conditions texts, exactly as PRODUCT_SPEC §5.5, §5.6 and §10.2 word them. Australian English. */

/** The extract button of one Decision Letter: several letters name the file, otherwise it depends on there being conditions already. */
export function extractLabel(fileName: string, letters: number, hasConditions: boolean): string {
  if (letters > 1) return `Extract conditions – ${fileName}`;
  return hasConditions ? "Re-extract conditions from Decision Letter" : "Extract conditions from Decision Letter";
}

export const READING_LETTER = "Reading Decision Letter…";

/** PDFs are in the folder but none is named "decision". */
export const DECISION_LETTER_ONLY =
  'Conditions can only be extracted from the Decision Letter – upload it with "Decision Letter" in the file name.';

/** The empty folder of a viewer who cannot upload. */
export const LETTER_GOES_HERE = "The WAPC conditional approval PDF goes here.";

/** The replace confirmation; the API words its 409 the same way. */
export function replaceText(count: number): string {
  return `Replace the ${count} existing conditions, including their ticks, comments and evidence?`;
}

/** The count out of the API's 409 detail ("Replace the 13 existing conditions, …"), or null when the 409 is about something else. */
export function replaceCountOf(detail: string | undefined): number | null {
  const match = /^Replace the (\d+) existing conditions/.exec(detail ?? "");
  return match?.[1] ? Number(match[1]) : null;
}

/** The success line (§5.5 "counts"); the guessed-agency note or the no-conditions note of the API follows it. */
export function extractedText(count: number): string {
  return `${count} ${count === 1 ? "condition" : "conditions"} extracted`;
}

/** The extraction ran and failed: the PDF could not be read (§10.2). */
export const UNREADABLE_LETTER = "This PDF couldn't be read. Try re-saving it as a PDF and uploading again.";

/** The extraction could not be started and the API gave no reason to show. */
export function extractionNotStartedText(name: string, requestId: string | undefined): string {
  return `Conditions couldn't be extracted from ${name}${requestId ? ` (Request ID: ${requestId})` : ""}`;
}

/** The badge of a condition whose agency was guessed, and its hover text (§5.6, §10.2). */
export const GUESSED_BADGE = "Agency guessed – please check";
export const GUESSED_TITLE = "No agency was named in brackets in the Decision Letter, so it was guessed";

/** The summary of the checklist: "5 of 13 cleared". */
export function clearedText(cleared: number, total: number): string {
  return `${cleared} of ${total} cleared`;
}

/** The checklist's footer once the conditions came from a file (§5.5). */
export function extractedFromText(fileName: string): string {
  return `Extracted from ${fileName} · changes here and in each agency section update each other`;
}

/** The small drop zone of a condition (§5.6). */
export const EVIDENCE_LABEL = "Drop clearance evidence here";
export const EVIDENCE_HINT = "photos, stat dec, approvals – or click to choose";
