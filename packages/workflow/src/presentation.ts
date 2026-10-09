/**
 * Small presentation helpers shared by the web app (job picker, dashboard) and the API (zip package, job summary).
 */
import { STAGES } from "./definition.js";
import type { SubdivisionType } from "./types.js";

export interface JobIdentity {
  readonly jobNumber: string;
  readonly address: string;
  readonly clientName: string | null;
  readonly subdivisionType: SubdivisionType | null;
}

/** "S-0042 – 1 Example Rd, Suburb – Client (Survey-Strata)" (prototype jobText). */
export function jobDisplayText(j: JobIdentity): string {
  const parts = [j.jobNumber || "Job", j.address, j.clientName].filter((p): p is string => Boolean(p));
  return parts.join(" – ") + (j.subdivisionType ? ` (${j.subdivisionType})` : "");
}

const collator = new Intl.Collator("en-AU", { numeric: true, sensitivity: "base" });

/** Natural sort by job number (S-0099 before S-0420 before S-1000). */
export function compareJobNumbers(a: string, b: string): number {
  return collator.compare(a, b);
}

/** Loose type key used by dashboard chips (prototype typeKey): lower-case letters only. */
export function subdivisionTypeKey(t: string | null | undefined): string {
  return (t ?? "").toLowerCase().replace(/[^a-z]/g, "");
}

/** File/folder-name-safe text (prototype safeName). */
export function safeName(s: string | null | undefined): string {
  const cleaned = (s ?? "")
    .replace(/[\\/:*?"<>|\p{Cc}]+/gu, " ")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/, "")
    .trim()
    .slice(0, 90);
  return cleaned || "file";
}

const pad2 = (n: number): string => String(n).padStart(2, "0");

/** "02 WAPC Approval" — folder for a stage in the job files zip. */
export function stageFolderName(stageKey: string): string {
  const i = STAGES.findIndex((s) => s.key === stageKey);
  const stage = STAGES[i];
  if (!stage) throw new RangeError(`Unknown stage: ${stageKey}`);
  return `${pad2(i + 1)} ${safeName(stage.name)}`;
}

/** Folder for a checkpoint's files: "02 WAPC Approval/4.3 Queries from WAPC[/Query emails]". */
export function checkpointFolderName(stageKey: string, number: string, title: string, isEmail: boolean): string {
  return `${stageFolderName(stageKey)}/${safeName(`${number} ${title}`)}${isEmail ? "/Query emails" : ""}`;
}

/** Folder for condition evidence: "03 Western Power/WAPC conditions/Condition 12 evidence". */
export function conditionEvidenceFolderName(stageKey: string, conditionNumber: number | string): string {
  return `${stageFolderName(stageKey)}/WAPC conditions/Condition ${safeName(String(conditionNumber))} evidence`;
}
