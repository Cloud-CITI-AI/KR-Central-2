import type { JobDetail } from "@kr/contracts";
import { compareJobNumbers, jobDisplayText, type JobIdentity } from "@kr/workflow";

export interface PickerEntry {
  readonly id: string;
  readonly jobNumber: string;
  readonly text: string;
  readonly isComplete: boolean;
}

export interface PickerGroup {
  readonly label: string;
  readonly entries: readonly PickerEntry[];
}

interface Listed extends JobIdentity {
  readonly id: string;
  readonly isComplete: boolean;
}

const toEntry = (job: Listed): PickerEntry => ({
  id: job.id,
  jobNumber: job.jobNumber,
  text: jobDisplayText(job),
  isComplete: job.isComplete,
});

/**
 * Picker options: "In progress (n)" then "Complete (n)", each in natural job-number order (§4). The open job always
 * appears and uses its live completeness, so the picker never lags behind the page the person is looking at.
 */
export function groupPickerJobs(listed: readonly Listed[], current: JobDetail): PickerGroup[] {
  const entries = [
    ...listed.filter((job) => job.id !== current.id).map(toEntry),
    toEntry({ ...current, isComplete: current.summary.isComplete }),
  ].sort((a, b) => compareJobNumbers(a.jobNumber, b.jobNumber));
  const groups: [string, PickerEntry[]][] = [
    ["In progress", entries.filter((e) => !e.isComplete)],
    ["Complete", entries.filter((e) => e.isComplete)],
  ];
  return groups
    .filter(([, list]) => list.length > 0)
    .map(([label, list]) => ({ label: `${label} (${list.length})`, entries: list }));
}
