"use client";
import type { JobDetail } from "@kr/contracts";
import type { StageDefinition } from "@kr/workflow";
import { Fragment, memo } from "react";
import { CheckpointCard } from "@/features/checkpoints";
import { AgencyConditions } from "@/features/conditions";
import { OutcomeBox } from "./OutcomeBox";
import styles from "./Stages.module.css";

export interface StageBodyProps {
  readonly job: JobDetail;
  readonly stage: StageDefinition;
}

/**
 * What an open stage holds (§5.3): the "WAPC conditions – <agency>" evidence box first in the agency stages and WAPC (it
 * renders nothing when that agency has no conditions), then one checkpoint card per checkpoint. Each card sits in an element
 * with the id `checkpoint-<key>` that deep links scroll to. The WAPC Approval stage shows the outcome box after 4.2 (§5.5).
 * Memoised: every stage body is mounted (closed ones are `hidden`), so opening or closing a stage, or Expand all, must not render the
 * 46 cards again; only the bar and the `hidden` attribute change (the tracker's INP, PRODUCT_SPEC §14).
 */
export const StageBody = memo(function StageBody({ job, stage }: StageBodyProps) {
  return (
    <>
      {stage.agency && <AgencyConditions job={job} agency={stage.agency} />}
      <div className={styles.items}>
        {stage.checkpoints.map((definition) => {
          const checkpoint = job.checkpoints.find((c) => c.key === definition.key);
          return checkpoint ? (
            <Fragment key={definition.key}>
              <div id={`checkpoint-${definition.key}`} className={styles.item}>
                <CheckpointCard job={job} checkpoint={checkpoint} definition={definition} />
              </div>
              {definition.key === stage.outcomeBoxAfter && <OutcomeBox job={job} />}
            </Fragment>
          ) : null;
        })}
      </div>
    </>
  );
});
