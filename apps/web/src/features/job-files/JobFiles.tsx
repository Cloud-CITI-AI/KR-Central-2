import type { JobDetail } from "@kr/contracts";

export interface JobFilesProps {
  readonly job: JobDetail;
}

/** "JOB FILES" section with the zip download (§5.8) — STUB owned by WP-17, placed by the tracker (WP-14). */
export function JobFiles({ job }: JobFilesProps) {
  return <section aria-label="Download job files" data-files={job.summary.fileCount} />;
}
