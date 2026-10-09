"use client";
import type { JobDetail } from "@kr/contracts";
import { JobFiles } from "@/features/job-files";
import { JobNotes } from "@/features/notes";
import { Jobbar } from "./Jobbar";
import { useOpenStages } from "./openStages";
import { Stages } from "./Stages";
import { SummaryPanels } from "./SummaryPanels";
import styles from "./TrackerBody.module.css";

export interface TrackerBodyProps {
  readonly job: JobDetail;
}

/** Everything under the page banners once the job is loaded: jobbar, summary panels, stages, then job notes and job files (§5). */
export function TrackerBody({ job }: TrackerBodyProps) {
  const stages = useOpenStages();
  return (
    <>
      <Jobbar job={job} onSaveAsPdf={stages.saveAsPdf} />
      <SummaryPanels job={job} />
      <Stages job={job} stages={stages} />
      <div className={styles.after}>
        <JobNotes jobId={job.id} capabilities={job.capabilities} />
        <JobFiles job={job} />
      </div>
    </>
  );
}
