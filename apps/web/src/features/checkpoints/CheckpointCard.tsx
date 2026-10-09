"use client";
import type { CheckpointState, JobDetail } from "@kr/contracts";
import { STATUS_LABELS, type CheckpointDefinition, type Panel } from "@kr/workflow";
import { useId } from "react";
import { ConditionsPanel } from "@/features/conditions";
import { ApprovalPanel } from "./ApprovalPanel";
import { assertNever } from "./assertNever";
import { CheckpointControls } from "./CheckpointControls";
import { CheckpointTags } from "./CheckpointTags";
import { CHECKPOINT_MESSAGES } from "./messages";
import { PaidPanel } from "./PaidPanel";
import { PanelBox } from "./PanelBox";
import { PhotosPanel } from "./PhotosPanel";
import { SlotFolderPanel } from "./SlotFolderPanel";
import { SlotsPanel } from "./SlotsPanel";
import { SurveyPanel } from "./SurveyPanel";
import styles from "./CheckpointCard.module.css";

export interface CheckpointCardProps {
  readonly job: JobDetail;
  readonly checkpoint: CheckpointState;
  readonly definition: CheckpointDefinition;
}

interface PanelViewProps extends CheckpointCardProps {
  readonly panel: Panel;
}

/** One panel of a checkpoint. Exhaustive over the `Panel` union: a new panel type fails to compile until it is rendered here. */
function PanelView({ panel, job, checkpoint }: PanelViewProps) {
  switch (panel.type) {
    case "conditions":
      return <ConditionsPanel job={job} checkpoint={checkpoint} />;
    case "documents":
      return panel.variant === "photos" ? (
        <PhotosPanel job={job} checkpoint={checkpoint} panel={panel} />
      ) : (
        <SlotFolderPanel job={job} checkpoint={checkpoint} slot={panel.slot} />
      );
    case "clearance":
      return <SlotFolderPanel job={job} checkpoint={checkpoint} slot={panel.slot} />;
    case "slots":
      return <SlotsPanel job={job} checkpoint={checkpoint} panel={panel} />;
    case "survey":
      return <SurveyPanel job={job} checkpoint={checkpoint} panel={panel} />;
    case "approval":
      return <ApprovalPanel job={job} checkpoint={checkpoint} panel={panel} />;
    case "paid":
      return <PaidPanel job={job} checkpoint={checkpoint} panel={panel} />;
    case "kr_note":
    case "conformance":
    case "emails":
      return null;
    default:
      return assertNever(panel);
  }
}

/**
 * One checkpoint card (PRODUCT_SPEC §5.4–5.5): number, title and status label, description, tags, then the panels of the
 * workflow definition in order. Colours follow the effective status. For a viewer without `fee_proposal.view` the fee
 * proposal's panels are replaced by one line of text.
 */
export function CheckpointCard({ job, checkpoint, definition }: CheckpointCardProps) {
  const titleId = useId();
  return (
    <div
      className={styles.card}
      data-checkpoint={checkpoint.key}
      data-s={checkpoint.status}
      role="group"
      aria-labelledby={titleId}
    >
      <div>
        <div className={styles.ttl}>
          <h3 id={titleId} className={styles.heading}>
            <span className={styles.num}>{definition.number}</span> <span>{definition.title}</span>
          </h3>
          <span className={styles.statLabel}>{STATUS_LABELS[checkpoint.status]}</span>
        </div>
        {definition.description && <p className={styles.det}>{definition.description}</p>}
        <CheckpointTags definition={definition} />
        {checkpoint.isRestricted ? (
          <PanelBox>
            <p className={styles.restricted}>{CHECKPOINT_MESSAGES.restricted}</p>
          </PanelBox>
        ) : (
          definition.panels.map((panel, index) => (
            <PanelView
              key={`${panel.type}-${index}`}
              panel={panel}
              job={job}
              checkpoint={checkpoint}
              definition={definition}
            />
          ))
        )}
      </div>
      <CheckpointControls
        jobId={job.id}
        capabilities={job.capabilities}
        checkpoint={checkpoint}
        definition={definition}
      />
    </div>
  );
}
