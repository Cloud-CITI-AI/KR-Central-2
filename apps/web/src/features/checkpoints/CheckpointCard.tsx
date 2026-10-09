import type { CheckpointState, JobDetail } from "@kr/contracts";
import type { CheckpointDefinition } from "@kr/workflow";

export interface CheckpointCardProps {
  readonly job: JobDetail;
  readonly checkpoint: CheckpointState;
  readonly definition: CheckpointDefinition;
}

/**
 * One checkpoint card (PRODUCT_SPEC §5.4–5.5) — STUB owned by WP-15. Rendered by the tracker (WP-14) for every
 * checkpoint of an open, non-excluded stage. Must render the panel of type "conditions" with
 * `<ConditionsPanel>` from "@/features/conditions".
 */
export function CheckpointCard({ checkpoint, definition }: CheckpointCardProps) {
  return (
    <div data-checkpoint={checkpoint.key} data-s={checkpoint.status}>
      {definition.number} {definition.title}
    </div>
  );
}
