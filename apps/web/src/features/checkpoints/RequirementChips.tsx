import styles from "./RequirementChips.module.css";

export interface RequirementChip {
  /** "PDF", "Clearance PDF". */
  readonly label: string;
  readonly received: boolean;
}

export interface RequirementChipsProps {
  readonly chips: readonly RequirementChip[];
}

/** "Clearance PDF required" (red) / "✓ Clearance PDF received" (green): the text carries the state, not only the colour. */
export function RequirementChips({ chips }: RequirementChipsProps) {
  if (chips.length === 0) return null;
  return (
    <div className={styles.chips}>
      {chips.map(({ label, received }) => (
        <span key={label} className={styles.chip} data-received={received}>
          {received ? `✓ ${label} received` : `${label} required`}
        </span>
      ))}
    </div>
  );
}
