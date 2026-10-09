"use client";
import type { JobDetail } from "@kr/contracts";
import { STAGES } from "@kr/workflow";
import { Button } from "@/components/ui/Button";
import type { OpenStages } from "./openStages";
import { StageBar } from "./StageBar";
import { StageBody } from "./StageBody";
import styles from "./Stages.module.css";

export interface StagesProps {
  readonly job: JobDetail;
  readonly stages: OpenStages;
}

/** The "STAGES" label with Expand all / Collapse all and the ten stage bars (§5.3). */
export function Stages({ job, stages }: StagesProps) {
  return (
    <>
      <div className={styles.tools}>
        <span className={styles.label}>Stages</span>
        <Button small onClick={stages.expandAll}>
          Expand all
        </Button>
        <Button small onClick={stages.collapseAll}>
          Collapse all
        </Button>
      </div>
      <div className={styles.stages}>
        {STAGES.map((stage) => {
          const summary = job.summary.stages.find((s) => s.stage === stage.key);
          if (!summary) return null;
          const open = !summary.excluded && stages.isOpen(stage.key);
          return (
            <section key={stage.key} id={stage.key} className={styles.stage}>
              <StageBar
                stage={stage}
                summary={summary}
                open={open}
                bodyId={`body-${stage.key}`}
                onToggle={() => {
                  stages.toggle(stage.key);
                }}
              />
              {!summary.excluded && (
                <div id={`body-${stage.key}`} className={styles.body} hidden={!open}>
                  <StageBody job={job} stage={stage} />
                </div>
              )}
            </section>
          );
        })}
      </div>
    </>
  );
}
