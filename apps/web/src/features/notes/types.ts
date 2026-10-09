import type { JobNote, JobNotePage } from "@kr/contracts";
import type { z } from "zod";

/** The contract exports the note as a schema only. */
export type Note = z.infer<typeof JobNote>;
export type NotePage = z.infer<typeof JobNotePage>;
