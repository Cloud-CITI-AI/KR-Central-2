import type { Facets } from "./types";
import styles from "./SummaryChips.module.css";

export interface SummaryChipsProps {
  readonly facets: Facets;
}

/** "n In progress", "n Complete", "n Waiting on client", "n Need attention" (§6), all from `getJobFacets`. */
export function SummaryChips({ facets }: SummaryChipsProps) {
  const chips = [
    ["n", facets.statusCounts.in_progress, "In progress"],
    ["c", facets.statusCounts.complete, "Complete"],
    ["w", facets.waitingOnClient, "Waiting on client"],
    ["x", facets.needAttention, "Need attention"],
  ] as const;
  return (
    <div className={styles.sum} role="group" aria-label="Summary">
      {chips.map(([kind, count, label]) => (
        <span key={kind} className={`${styles.cnt} ${styles[kind]}`}>
          <b>{count}</b> {label}
        </span>
      ))}
    </div>
  );
}
