import type { Note } from "./types";

/** Job notes texts, exactly as PRODUCT_SPEC §5.7 (the prototype's wording). Australian English. */
export const NOTES_MESSAGES = {
  title: "Job notes",
  description: "Any notes relevant to the subdivision. Any party can post a note.",
  empty: "No notes on this job yet.",
  loadFailed: "The notes failed to load. Reload the page and try again.",
  deleteFailed: "That note couldn't be deleted. Try again.",
} as const;

/** The "For:" select. A label only: everyone on the job reads every note (§5.7). */
export const AUDIENCE_OPTIONS = [
  ["all", "Everyone"],
  ["surveyor", "Surveyor"],
  ["client", "Client"],
] as const satisfies readonly (readonly [Note["audience"], string])[];

export const AUDIENCE_LABELS: Record<Note["audience"], string> = {
  all: "For everyone",
  surveyor: "For surveyor",
  client: "For client",
};

export function saveFailedText(requestId: string | undefined): string {
  const text = "That note couldn't be saved. Try again.";
  return requestId ? `${text} (Request ID: ${requestId})` : text;
}
