import type { JobCapability } from "@kr/contracts";

export interface JobNotesProps {
  readonly jobId: string;
  readonly capabilities: readonly JobCapability[];
}

/** "JOB NOTES" section (§5.7) — STUB owned by WP-17, placed by the tracker (WP-14) after the stages. */
export function JobNotes({ jobId }: JobNotesProps) {
  return <section aria-label="Job notes" data-job={jobId} />;
}
