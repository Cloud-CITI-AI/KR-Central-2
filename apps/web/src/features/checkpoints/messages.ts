/** Checkpoint card texts, exactly as PRODUCT_SPEC §5.4–5.5 words them. Australian English. */
export const CHECKPOINT_MESSAGES = {
  /** Panel content of the fee proposal for a viewer without `fee_proposal.view` (§5.4). */
  restricted: "Fee proposal details are visible to KR Admin and the client only.",
} as const;

/** "2 files uploaded" for the live region after an upload. */
export function uploadedText(count: number): string {
  return `${count} ${count === 1 ? "file" : "files"} uploaded`;
}

/** "2 files" / "1 file" / the panel's empty text ("empty", "not received yet", "none yet"). */
export function fileCountText(count: number, empty: string, noun = "file"): string {
  return count === 0 ? empty : `${count} ${noun}${count === 1 ? "" : "s"}`;
}
