"use client";
import type { JobDetail } from "@kr/contracts";
import { Jobbar } from "./Jobbar";
import { useOpenStages } from "./openStages";
import { Stages } from "./Stages";
import { SummaryPanels } from "./SummaryPanels";

export interface TrackerBodyProps {
  readonly job: JobDetail;
}

/** Everything under the page banners once the job is loaded: jobbar, summary panels and the stages (§5). */
export function TrackerBody({ job }: TrackerBodyProps) {
  const stages = useOpenStages();
  return (
    <>
      <Jobbar job={job} onSaveAsPdf={stages.saveAsPdf} />
      <SummaryPanels job={job} />
      <Stages job={job} stages={stages} />
    </>
  );
}
