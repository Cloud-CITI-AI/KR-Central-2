import type { JobCapability } from "@kr/contracts";
import type { SlotDefinition } from "@kr/workflow";

/**
 * Whether the viewer may upload into a slot: "staff" slots need `files.upload.staff_slots`, every other slot
 * `files.upload.client_slots` (the API's rule, §2.1). The capabilities come from `JobDetail.capabilities`, never from a role.
 */
export function canUploadToSlot(
  capabilities: readonly JobCapability[],
  slot: Pick<SlotDefinition, "uploaders">,
): boolean {
  return capabilities.includes(slot.uploaders === "staff" ? "files.upload.staff_slots" : "files.upload.client_slots");
}
