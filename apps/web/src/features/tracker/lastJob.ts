/** localStorage key read by the dashboard's "← BACK TO TRACKER" (WP-13). */
export const LAST_JOB_KEY = "kr-last-job";

/** Remember the opened job. Storage can be blocked (private window): then nothing is remembered. */
export function rememberLastJob(jobId: string): void {
  try {
    localStorage.setItem(LAST_JOB_KEY, jobId);
  } catch {
    // storage blocked: the back link simply stays hidden
  }
}
