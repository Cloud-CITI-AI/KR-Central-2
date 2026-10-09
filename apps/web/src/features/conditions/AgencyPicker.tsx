"use client";
import type { Condition } from "@kr/contracts";
import { AGENCIES, type Agency } from "@kr/workflow";
import { Select } from "@/components/ui/Select";
import styles from "./ConditionCard.module.css";

export interface AgencyPickerProps {
  readonly condition: Condition;
  readonly onChange: (agency: Agency) => void;
  /** "Agency is correct": keeps the guessed agency and ends the guess. */
  readonly onConfirm: () => void;
}

/** The agency select of a checklist card, with "Agency is correct" while the agency is a guess (§5.6). */
export function AgencyPicker({ condition, onChange, onConfirm }: AgencyPickerProps) {
  return (
    <span className={styles.picker}>
      <Select
        className={styles.agencySelect}
        aria-label={`Agency for condition ${condition.number}`}
        value={condition.agency}
        onChange={(event) => {
          onChange(event.target.value as Agency);
        }}
      >
        {AGENCIES.map((agency) => (
          <option key={agency} value={agency}>
            {agency}
          </option>
        ))}
      </Select>
      {condition.agencyGuessed && (
        <button type="button" className={styles.linkButton} onClick={onConfirm}>
          Agency is correct
        </button>
      )}
    </span>
  );
}
