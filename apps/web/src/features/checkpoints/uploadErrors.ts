import { ApiProblem } from "@/lib/api";
import { formatMegabytes } from "@/lib/format";

export interface UploadErrorContext {
  /** The slot's accepted kinds in words, e.g. "PDF or photo". */
  readonly acceptDescription: string;
  readonly maxBytes: number;
}

/**
 * The line listed under the card for a file the API refused. 413 and 415 use the §5.5 wording; the others are additions
 * in the same voice (the request id is shown when there is one, EH-1).
 */
export function uploadErrorText(
  name: string,
  error: unknown,
  { acceptDescription, maxBytes }: UploadErrorContext,
): string {
  if (!(error instanceof ApiProblem)) return `${name} couldn't be uploaded`;
  switch (error.status) {
    case 413:
      return `${name} is larger than ${formatMegabytes(maxBytes)} MB`;
    case 415:
      return `${name} isn't a supported type for this box (use ${acceptDescription})`;
    case 429:
      return `${name} wasn't uploaded – too many uploads at once, try again shortly`;
    case 503:
      return `${name} wasn't uploaded – file storage is temporarily unavailable, try again shortly`;
    case 0:
      return `${name} couldn't be uploaded – check your connection and try again`;
    default:
      return `${name} couldn't be uploaded${error.requestId ? ` (Request ID: ${error.requestId})` : ""}`;
  }
}
