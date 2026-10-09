import type { JobCapability } from "@kr/contracts";

export interface ConditionPermissions {
  /** Tick, agency, responsibility and the KR comment (`conditions.edit`, §2.1). */
  readonly edit: boolean;
  /** The client comment: open to everyone with access (`conditions.client_comment.edit`). */
  readonly comment: boolean;
  /** Evidence uploads (`conditions.evidence.upload`). */
  readonly evidence: boolean;
}

/** What the viewer may change on a condition, from `JobDetail.capabilities` (never from a role). */
export function conditionPermissions(capabilities: readonly JobCapability[]): ConditionPermissions {
  return {
    edit: capabilities.includes("conditions.edit"),
    comment: capabilities.includes("conditions.client_comment.edit"),
    evidence: capabilities.includes("conditions.evidence.upload"),
  };
}
