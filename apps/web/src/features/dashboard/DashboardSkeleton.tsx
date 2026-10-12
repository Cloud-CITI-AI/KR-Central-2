import { VisuallyHidden } from "@/components/ui/VisuallyHidden";
import styles from "./Dashboard.module.css";

const CARDS = [0, 1, 2, 3, 4, 5] as const;

/**
 * What the dashboard shows under its jobbar until its content chunk has loaded: boxes at the size of the header, the summary
 * chips and the cards, so nothing moves when the real ones arrive (CLS). Only the status is announced; the boxes are decoration.
 * It is in the first load (FE-9), so it is markup and CSS only: no data, no imports beyond the screen-reader text.
 */
export function DashboardSkeleton() {
  return (
    <div className={styles.dash} aria-busy="true">
      <div role="status" className={styles.skLive}>
        <VisuallyHidden>Loading dashboard…</VisuallyHidden>
      </div>
      <div className={styles.skHead} aria-hidden="true" />
      <div className={styles.skSum} aria-hidden="true" />
      <div className={styles.skGrid} aria-hidden="true">
        {CARDS.map((n) => (
          <div key={n} className={styles.skCard} />
        ))}
      </div>
    </div>
  );
}
