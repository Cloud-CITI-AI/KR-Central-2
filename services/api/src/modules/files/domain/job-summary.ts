/**
 * "Job summary.txt" in the job package (PRODUCT_SPEC §5.8; prototype jobSummaryText): the job line, when it was
 * downloaded, the conformed and outcome dates, every stage with each checkpoint's status, the conditions with their
 * comments and the job notes. Statuses are the effective ones (an excluded agency stage reads "Not required"). Pure.
 */
import type { CheckpointStatus, Responsibility } from "@kr/workflow";
import {
  STAGES,
  STATUS_LABELS,
  SUBDIVISION_TYPES,
  effectiveState,
  formatDateLong,
  isAgencyExcluded,
  jobDisplayText,
  type Agency,
  type CheckpointStateInput,
} from "@kr/workflow";
import { formatPerthDateTime } from "./pasted-email.js";

export interface SummaryJob {
  readonly jobNumber: string;
  readonly address: string;
  readonly clientName: string | null;
  readonly subdivisionType: string | null;
  readonly conformedDate: string | null;
  readonly outcomeDate: string | null;
}

export interface SummaryCondition {
  readonly number: number;
  readonly agency: Agency;
  readonly agencyGuessed: boolean;
  readonly text: string;
  readonly isCleared: boolean;
  readonly krComment: string;
  readonly clientComment: string;
}

export interface SummaryNote {
  readonly createdAt: Date;
  readonly audience: string;
  readonly body: string;
}

export interface SummaryInput {
  readonly job: SummaryJob;
  readonly states: readonly {
    readonly checkpointKey: string;
    readonly status: CheckpointStatus;
    readonly responsibility: Responsibility | null;
  }[];
  readonly conditions: readonly SummaryCondition[];
  /** Oldest first. */
  readonly notes: readonly SummaryNote[];
  /** Zip paths (without the top folder) of files whose stored object could not be found; listed so nothing is silent. */
  readonly missingFiles?: readonly string[];
  readonly now: Date;
}

const pad2 = (n: number): string => String(n).padStart(2, "0");

export function buildJobSummary(input: SummaryInput): string {
  const { job } = input;
  const subdivisionType = SUBDIVISION_TYPES.find((t) => t === job.subdivisionType) ?? null;
  const lines = [jobDisplayText({ ...job, subdivisionType }), `Downloaded ${formatPerthDateTime(input.now)}`, ""];
  const missing = input.missingFiles ?? [];
  if (missing.length > 0) {
    lines.push(
      `FILES NOT INCLUDED (${missing.length})`,
      "  These files could not be read from storage, so they are not in this zip. Ask KR Surveys to restore them.",
      ...missing.map((path) => `  ${path}`),
      "",
    );
  }
  if (job.conformedDate) {
    lines.push(
      `Conformed date: ${formatDateLong(job.conformedDate)}`,
      `WAPC outcome date: ${job.outcomeDate ? formatDateLong(job.outcomeDate) : "–"}`,
      "",
    );
  }
  const states: Record<string, CheckpointStateInput> = {};
  for (const s of input.states) {
    states[s.checkpointKey] = { status: s.status, responsibility: s.responsibility };
  }
  const rule = {
    states,
    conditions: input.conditions.map((c) => ({
      agency: c.agency,
      isCleared: c.isCleared,
      agencyGuessed: c.agencyGuessed,
    })),
  };
  STAGES.forEach((stage, i) => {
    const excluded = isAgencyExcluded(stage, rule.conditions);
    lines.push(
      `${pad2(i + 1)} ${stage.name.toUpperCase()}${excluded ? "  (not required – no conditions in the Decision Letter)" : ""}`,
    );
    for (const checkpoint of stage.checkpoints) {
      const { status } = effectiveState(checkpoint.key, rule);
      lines.push(`  ${checkpoint.number.padEnd(5)} ${STATUS_LABELS[status].padEnd(14)} ${checkpoint.title}`);
    }
    lines.push("");
  });
  if (input.conditions.length > 0) {
    lines.push("WAPC CONDITIONS");
    for (const c of input.conditions) {
      lines.push(`  ${String(c.number).padEnd(3)} ${c.isCleared ? "Cleared" : "Open   "}  ${c.agency}  –  ${c.text}`);
      if (c.krComment) lines.push(`        KR comment: ${c.krComment}`);
      if (c.clientComment) lines.push(`        Client comment: ${c.clientComment}`);
    }
  }
  if (input.notes.length > 0) {
    lines.push("", "JOB NOTES");
    for (const n of input.notes) {
      lines.push(
        `  ${formatPerthDateTime(n.createdAt)}  (for ${n.audience})`,
        ...n.body.split("\n").map((t) => `    ${t}`),
      );
    }
  }
  return lines.join("\r\n");
}
