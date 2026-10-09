"use client";
import type { JobDetail } from "@kr/contracts";
import type { StageDefinition } from "@kr/workflow";
import { CheckpointCard } from "@/features/checkpoints";
import { AgencyConditions } from "@/features/conditions";
import styles from "./Stages.module.css";

export interface StageBodyProps {
  readonly job: JobDetail;
  readonly stage: StageDefinition;
}

/**
 * What an open stage holds (§5.3): the "WAPC conditions – <agency>" evidence box first in the agency stages and WAPC (it
 * renders nothing when that agency has no conditions), then one checkpoint card per checkpoint. Each card sits in an element
 * with the id `checkpoint-<key>` that deep links scroll to.
 */
export function StageBody({ job, stage }: StageBodyProps) {
  return (
    <>
      {stage.agency && <AgencyConditions job={job} agency={stage.agency} />}
      <div className={styles.items}>
        {stage.checkpoints.map((definition) => {
          const checkpoint = job.checkpoints.find((c) => c.key === definition.key);
          return checkpoint ? (
            <div key={definition.key} id={`checkpoint-${definition.key}`} className={styles.item}>
              <CheckpointCard job={job} checkpoint={checkpoint} definition={definition} />
            </div>
          ) : null;
        })}
      </div>
    </>
  );
}
