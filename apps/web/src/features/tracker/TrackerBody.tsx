"use client";
import type { JobDetail } from "@kr/contracts";
import type { StageKey } from "@kr/workflow";
import { JobFiles } from "@/features/job-files";
import { JobNotes } from "@/features/notes";
import { Jobbar } from "./Jobbar";
import { useOpenStages } from "./openStages";
import { Stages } from "./Stages";
import { SummaryPanels } from "./SummaryPanels";
import styles from "./TrackerBody.module.css";
import { useStageLinks } from "./useStageLinks";

export interface TrackerBodyProps {
  readonly job: JobDetail;
  /** `?stage=<stageKey>`: opened and scrolled to on arrival. */
  readonly initialStage?: StageKey | undefined;
}

/** Everything under the page banners once the job is loaded: jobbar, summary panels, stages, then job notes and job files (§5). */
export function TrackerBody({ job, initialStage }: TrackerBodyProps) {
  const stages = useOpenStages();
  useStageLinks(stages, initialStage);
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
