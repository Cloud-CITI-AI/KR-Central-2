import type { CheckpointDefinition } from "@kr/workflow";
import { Tag } from "@/components/ui/Tag";
import styles from "./CheckpointCard.module.css";

export interface CheckpointTagsProps {
  readonly definition: CheckpointDefinition;
}

/** The claim tag ("ITEM 2 PAYMENT REQUIRED") and the fee tag ("$ WAPC Form 1A payment": yellow client pays, blue KR pays). */
export function CheckpointTags({ definition }: CheckpointTagsProps) {
  const { progressClaim, fee } = definition;
  if (!progressClaim && !fee) return null;
  return (
    <div className={styles.meta}>
      {progressClaim && (
        <span title="KR progress claim">
          <Tag variant="claim">{progressClaim.toUpperCase()}</Tag>
        </span>
      )}
      {fee && (
        <span title={fee.payer === "kr" ? "KR payment" : "Client payment"}>
          <Tag variant={fee.payer === "kr" ? "krpay" : "fee"}>$ {fee.label}</Tag>
        </span>
      )}
    </div>
  );
}
