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

/** Teams channel names are at most this long (ADR-0015 A5). */
export const CHANNEL_NAME_MAX = 50;
/** Characters Teams refuses in channel names, plus control characters. */
const CHANNEL_FORBIDDEN = /[~#%&*{}+/\\:<>?|'"\p{Cc}]+/gu;

function trimTo(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

/**
 * The channel name the app creates for a job (ADR-0015 A5): `S-<job number>_<ADDRESS IN CAPS> (<client>)`.
 * `/` in the job number becomes `-`; the address is upper-cased; forbidden characters are dropped; the whole thing is
 * kept within 50 characters by shortening the client first (with `…`), then the address. Pure and the only place
 * this rule lives: the api previews and checks it, the worker creates with it.
 */
export function channelNameFor(job: {
  readonly jobNumber: string;
  readonly address: string;
  readonly clientName?: string | null;
}): string {
  const clean = (s: string) => s.replace(CHANNEL_FORBIDDEN, " ").replace(/\s+/g, " ").trim();
  const number = clean(job.jobNumber.replaceAll("/", "-"));
  const address = clean(job.address).toUpperCase();
  const client = clean(job.clientName ?? "");
  if (!number && !address && !client) return "S-job";
  const head = `S-${number}_`;
  const build = (addr: string, cl: string) => `${head}${addr}${cl ? ` (${cl})` : ""}`;
  let name = build(address, client);
  if (name.length <= CHANNEL_NAME_MAX) return name.replace(/[. ]+$/, "") || "S-job";
  // shorten the client first, down to nothing
  const roomForClient = CHANNEL_NAME_MAX - head.length - address.length - 3; // " (" + ")"
  if (client && roomForClient >= 2) name = build(address, trimTo(client, roomForClient));
  else name = build(address, "");
  if (name.length > CHANNEL_NAME_MAX) name = build(trimTo(address, CHANNEL_NAME_MAX - head.length), "");
  return name.slice(0, CHANNEL_NAME_MAX).replace(/[. ]+$/, "") || "S-job";
}

/** "name" → "name (2)", kept within the limit, for a reused job number whose generated name is taken (A5). */
export function channelNameWithSuffix(name: string, n: number): string {
  const suffix = ` (${n})`;
  return `${trimTo(name, CHANNEL_NAME_MAX - suffix.length)
    .replace(/…$/, "")
    .trimEnd()}${suffix}`;
}
