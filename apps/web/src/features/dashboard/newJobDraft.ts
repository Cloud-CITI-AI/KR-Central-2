import { draftKey } from "@/lib/api";

/** Where the NEW JOB form's unsaved fields are kept when the session ends; the dashboard also asks, to reopen the form (§3.1, §15). */
export const newJobDraftKey = (userId: string): string => draftKey(userId, "new-job");
