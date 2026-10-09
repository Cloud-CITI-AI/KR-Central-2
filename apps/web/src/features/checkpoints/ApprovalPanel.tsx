import type { CheckpointState, JobDetail } from "@kr/contracts";
import type { ApprovalPanel as ApprovalPanelDefinition } from "@kr/workflow";
import { DecisionArea } from "./DecisionArea";
import { PanelBox } from "./PanelBox";

export interface ApprovalPanelProps {
  readonly job: JobDetail;
  readonly checkpoint: CheckpointState;
  readonly panel: ApprovalPanelDefinition;
}

/** An approval panel (§5.5): the decision area; the document folder and the extra slot follow in the next commit. */
export function ApprovalPanel({ job, checkpoint, panel }: ApprovalPanelProps) {
  return (
    <PanelBox>
      <DecisionArea
        jobId={job.id}
        checkpoint={checkpoint}
        panel={panel}
        canRecord={job.capabilities.includes("checkpoint.decision.record")}
      />
    </PanelBox>
  );
}
