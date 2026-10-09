import type { Note } from "./types";

/** Job notes texts, exactly as PRODUCT_SPEC §5.7 (the prototype's wording). Australian English. */
export const NOTES_MESSAGES = {
  title: "Job notes",
  description: "Any notes relevant to the subdivision. Any party can post a note.",
  empty: "No notes on this job yet.",
  loadFailed: "The notes failed to load. Reload the page and try again.",
} as const;

export const AUDIENCE_LABELS: Record<Note["audience"], string> = {
  all: "For everyone",
  surveyor: "For surveyor",
  client: "For client",
};
