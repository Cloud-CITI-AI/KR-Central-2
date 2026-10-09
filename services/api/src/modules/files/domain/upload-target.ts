/**
 * Where an upload goes and who may put it there (PRODUCT_SPEC §2.1, §5.5, §11). Pure: callers load the rows and pass
 * the sniffed content in. The slot table lives in @kr/workflow; permissions in @kr/contracts.
 */
import type { JobCapability, UploadFields } from "@kr/contracts";
import { EVIDENCE_ACCEPT, getCheckpoint, findSlot, type FileKind, type SlotDefinition } from "@kr/workflow";
import type { ClassifyResult, ContentClassification } from "@kr/storage";
import type { z } from "zod";
import { BadRequestError, UnsupportedMediaTypeError } from "../../../platform/errors.js";

export type UploadTarget =
  | {
      readonly type: "slot";
      readonly checkpointKey: string;
      readonly slot: SlotDefinition;
      readonly accept: readonly FileKind[];
      /** Every job capability the caller needs (the slot's uploaders, plus the fee proposal's own). */
      readonly required: readonly JobCapability[];
    }
  | {
      readonly type: "evidence";
      readonly conditionId: string;
      readonly accept: readonly FileKind[];
      readonly required: readonly JobCapability[];
    };

/** The capability that lets a caller upload into a slot (staff always hold both; clients only the second). */
function uploadCapability(uploaders: SlotDefinition["uploaders"]): JobCapability {
  return uploaders === "staff" ? "files.upload.staff_slots" : "files.upload.client_slots";
}

export function resolveUploadTarget(fields: z.output<typeof UploadFields>): UploadTarget {
  if (fields.conditionId !== undefined) {
    return {
      type: "evidence",
      conditionId: fields.conditionId,
      accept: EVIDENCE_ACCEPT,
      required: ["conditions.evidence.upload"],
    };
  }
  // UploadFields guarantees both are present when there is no conditionId.
  const checkpointKey = fields.checkpointKey ?? "";
  const slot = findSlot(checkpointKey, fields.slot ?? "");
  if (!slot) {
    throw new BadRequestError({ errors: [{ path: "slot", message: "This checkpoint has no such upload box." }] });
  }
  const required: JobCapability[] = [uploadCapability(slot.uploaders)];
  // The fee proposal and its files are for fee_proposal.view holders only (PRODUCT_SPEC §5.4).
  if (getCheckpoint(checkpointKey).restricted === "fee_proposal") required.push("fee_proposal.view");
  return { type: "slot", checkpointKey, slot, accept: slot.accept, required };
}

const KIND_LABELS: Readonly<Record<FileKind, string>> = {
  pdf: "PDF",
  image: "photo",
  video: "video",
  text: "text",
  dwg: "DWG",
  email: "Outlook .msg or .eml email",
};

/** "PDF or photo", "PDF, photo, video or text". */
export function describeAccept(accept: readonly FileKind[]): string {
  const labels = accept.map((k) => KIND_LABELS[k]);
  return labels.length <= 1 ? (labels[0] ?? "") : `${labels.slice(0, -1).join(", ")} or ${labels.at(-1)}`;
}

/**
 * The slot's accept list, enforced on what the bytes are (never on the name or declared type). Throws 415 with a reason
 * the uploader can read.
 */
export function assertAcceptedContent(
  result: ClassifyResult,
  accept: readonly FileKind[],
): asserts result is ContentClassification {
  if ("rejected" in result) {
    throw new UnsupportedMediaTypeError({
      detail: result.rejected,
      errors: [{ path: "file", message: result.rejected }],
    });
  }
  if (!accept.includes(result.kind)) {
    const message = `This box accepts ${describeAccept(accept)} files only.`;
    throw new UnsupportedMediaTypeError({ detail: message, errors: [{ path: "file", message }] });
  }
}
