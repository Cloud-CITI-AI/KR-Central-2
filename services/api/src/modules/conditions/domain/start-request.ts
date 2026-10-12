/**
 * Which file a document-reading request may use (PRODUCT_SPEC §5.5, §10.1, §10.2). Pure: the route loads the file row and
 * this decides; every message that reaches the user is spelled out here.
 *
 * Conditions are read only from a clean PDF in the 5.0 decision slot of the SAME job whose name contains "decision";
 * the conformed date only from a clean PDF in the 4.2 slot. A file that does not exist, is deleted, belongs to another
 * job or sits in another slot gets one answer, so the response never says whether a file id exists elsewhere.
 */
import { PROBLEM_TYPES, type ProblemType } from "@kr/contracts";
import type { FileRow } from "@kr/db";
import {
  CONDITIONAL_APPROVAL_CHECKPOINT_KEY,
  CONFORMANCE_CHECKPOINT_KEY,
  getCheckpoint,
  slotsOf,
  type SlotDefinition,
} from "@kr/workflow";

export type RequestedFile = Pick<
  FileRow,
  "id" | "job_id" | "checkpoint_key" | "slot" | "original_name" | "kind" | "scan_status" | "deleted_at"
>;

export interface Rejection {
  readonly type: ProblemType;
  readonly detail: string;
}

interface Target {
  readonly checkpointKey: string;
  readonly slot: SlotDefinition;
  /** Shown when the file is not a PDF in that box. */
  readonly wrongPlace: string;
  readonly mustBeNamedDecision: boolean;
}

function slotOf(checkpointKey: string): SlotDefinition {
  const slot = slotsOf(getCheckpoint(checkpointKey))[0];
  if (!slot) throw new RangeError(`Checkpoint ${checkpointKey} has no upload slot`);
  return slot;
}

const EXTRACTION: Target = {
  checkpointKey: CONDITIONAL_APPROVAL_CHECKPOINT_KEY,
  slot: slotOf(CONDITIONAL_APPROVAL_CHECKPOINT_KEY),
  wrongPlace: "Conditions can only be read from a PDF in the WAPC conditional approval box (5.0).",
  mustBeNamedDecision: true,
};

const CONFORMANCE: Target = {
  checkpointKey: CONFORMANCE_CHECKPOINT_KEY,
  slot: slotOf(CONFORMANCE_CHECKPOINT_KEY),
  wrongPlace: "The conformed date can only be read from a PDF in the Conformance Notification box (4.2).",
  mustBeNamedDecision: false,
};

/** §5.5 */
export const NOT_A_DECISION_LETTER =
  'Conditions can only be extracted from the Decision Letter – upload it with "Decision Letter" in the file name.';

/** 409 detail when a reading of the same kind is already queued or running for the job (the tracker shows it as "Reading…"). */
export const EXTRACTION_IN_PROGRESS = "The Decision Letter is already being read. Wait for it to finish.";
export const CONFORMANCE_IN_PROGRESS = "The conformed date is already being read. Wait for it to finish.";

/** §5.5 confirm text, used as the 409 detail when `replaceExisting` is missing. */
export function replaceExistingMessage(count: number): string {
  return `Replace the ${count} existing conditions, including their ticks, comments and evidence?`;
}

function judge(file: RequestedFile | undefined, jobId: string, target: Target): Rejection | null {
  const conflict = (detail: string): Rejection => ({ type: PROBLEM_TYPES.conflict, detail });
  const inPlace =
    file?.deleted_at === null &&
    file.job_id === jobId &&
    file.checkpoint_key === target.checkpointKey &&
    file.slot === target.slot.key &&
    file.kind === "pdf";
  if (!inPlace) return conflict(target.wrongPlace);
  if (target.mustBeNamedDecision && !file.original_name.toLowerCase().includes("decision")) {
    return conflict(NOT_A_DECISION_LETTER);
  }
  const name = file.original_name;
  switch (file.scan_status) {
    case "clean":
    case "skipped": // scanning switched off (MALWARE_SCAN_MODE): the same state getFileContent serves
      return null;
    case "pending":
      return {
        type: PROBLEM_TYPES.fileNotReady,
        detail: `${name} is still being checked for viruses. Try again in a moment.`,
      };
    case "error":
      return {
        type: PROBLEM_TYPES.fileNotReady,
        detail: `${name} couldn't be checked for viruses – remove it and upload it again`,
      };
    case "infected":
      return { type: PROBLEM_TYPES.fileRejected, detail: `${name} was blocked because it failed the virus scan.` };
  }
}

/** Null when the file may be read for conditions; otherwise the problem to answer with (409). */
export const rejectExtractionFile = (file: RequestedFile | undefined, jobId: string): Rejection | null =>
  judge(file, jobId, EXTRACTION);

/** Null when the file may be read for the conformed date; otherwise the problem to answer with (409). */
export const rejectConformanceFile = (file: RequestedFile | undefined, jobId: string): Rejection | null =>
  judge(file, jobId, CONFORMANCE);
