import type { JobDetail } from "@kr/contracts";
import type { Agency } from "@kr/workflow";

export interface AgencyConditionsProps {
  readonly job: JobDetail;
  readonly agency: Agency;
}

/**
 * "WAPC conditions – <agency>" evidence box shown first inside an agency stage (and WAPC) when that agency has
 * conditions; renders nothing otherwise — STUB owned by WP-16, placed by the tracker (WP-14).
 */
export function AgencyConditions({ job, agency }: AgencyConditionsProps) {
  const mine = job.conditions.filter((c) => c.agency === agency);
  return mine.length ? <div data-agency-conditions={agency} /> : null;
}
