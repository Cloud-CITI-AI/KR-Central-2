"use client";
import type { CheckpointState, JobCapability } from "@kr/contracts";
import { CHECKPOINT_STATUSES, RESPONSIBILITIES, RESPONSIBILITY_LABELS, STATUS_LABELS } from "@kr/workflow";
import type { CheckpointDefinition, Responsibility } from "@kr/workflow";
import { Select } from "@/components/ui/Select";
import { useUpdateCheckpoint } from "./useUpdateCheckpoint";
import styles from "./CheckpointControls.module.css";

export interface CheckpointControlsProps {
  readonly jobId: string;
  readonly capabilities: readonly JobCapability[];
  readonly checkpoint: CheckpointState;
  readonly definition: CheckpointDefinition;
}

/**
 * The control column of a card (§5.4): the segmented status buttons and the responsibility select. Each change saves at
 * once (optimistic, `If-Match`). Disabled without the capability, and for a fee proposal the viewer cannot see.
 */
export function CheckpointControls({ jobId, capabilities, checkpoint, definition }: CheckpointControlsProps) {
  const update = useUpdateCheckpoint(jobId, checkpoint.key);
  const editable = (capability: JobCapability) => capabilities.includes(capability) && !checkpoint.isRestricted;
  return (
    <div className={styles.ctrl}>
      <div className={styles.seg} role="group" aria-label={`Status for ${definition.number}`}>
        {CHECKPOINT_STATUSES.map((status) => (
          <button
            key={status}
            type="button"
            data-v={status}
            aria-pressed={checkpoint.status === status}
            disabled={!editable("checkpoint.status.edit")}
            onClick={() => {
              if (checkpoint.status !== status) update.mutate({ status });
            }}
          >
            {STATUS_LABELS[status]}
          </button>
        ))}
      </div>
      <div className={styles.row}>
        <Select
          aria-label={`Responsibility for ${definition.number}`}
          value={checkpoint.responsibility ?? ""}
          disabled={!editable("checkpoint.responsibility.edit")}
          onChange={(event) => {
            const responsibility: Responsibility | null =
              RESPONSIBILITIES.find((r) => r === event.target.value) ?? null;
            update.mutate({ responsibility });
          }}
        >
          <option value="">{RESPONSIBILITY_LABELS.unassigned}</option>
          {RESPONSIBILITIES.map((r) => (
            <option key={r} value={r}>
              {RESPONSIBILITY_LABELS[r]}
            </option>
          ))}
        </Select>
      </div>
    </div>
  );
}
