import { Panel } from "@/components/ui/Panel";
import { Tag } from "@/components/ui/Tag";
import styles from "./SummaryPanels.module.css";

/**
 * "STATUS KEY" (§5.2): the three status swatches and the three card tags. Static, so never interactive. As in the prototype the
 * panel is the grid (heading and rows are its direct children): the heading's rule spans the panel and the rows share its height.
 */
export function StatusKey() {
  return (
    <Panel title="Status key" className={styles.legend}>
      <div>
        <span className={`${styles.sw} ${styles.swCompleted}`} aria-hidden="true" />
        Completed
      </div>
      <div>
        <span className={`${styles.sw} ${styles.swNotCompleted}`} aria-hidden="true" />
        Not completed
      </div>
      <div>
        <span className={`${styles.sw} ${styles.swNotRequired}`} aria-hidden="true" />
        Not required
      </div>
      <div className={styles.paykey}>
        <span>
          <Tag variant="claim">ITEM</Tag> KR progress claim
        </span>
        <span>
          <Tag variant="krpay">$</Tag> KR payment
        </span>
        <span>
          <Tag variant="fee">$</Tag> Client payment
        </span>
      </div>
    </Panel>
  );
}
