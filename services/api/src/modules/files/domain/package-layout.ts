/**
 * Where each file goes in the job package zip (PRODUCT_SPEC §5.8): `<job number> – subdivision files.zip` holding one
 * top folder `<job number> – <address>`, a folder per stage ("02 WAPC Approval"), a sub-folder per checkpoint ("4.3
 * Queries from WAPC", emails in "/Query emails"), condition evidence under the agency's stage, " (2)" on duplicate
 * names and "Job summary.txt". Folder names come from the @kr/workflow presentation helpers. Pure.
 */
import {
  STAGES,
  checkpointFolderName,
  conditionEvidenceFolderName,
  jobDisplayText,
  safeName,
  type FileKind,
} from "@kr/workflow";
import { servedFileName } from "@kr/storage";

export interface PackageFile {
  readonly id: string;
  readonly name: string;
  readonly kind: FileKind;
  readonly checkpointKey: string | null;
  readonly conditionId: string | null;
  readonly storageKey: string;
  readonly uploadedAt: Date;
}

export interface PackageCondition {
  readonly id: string;
  readonly number: number;
  readonly agency: string;
}

export interface PlannedEntry {
  readonly file: PackageFile;
  /** Full path inside the zip, top folder included. */
  readonly path: string;
}

export interface PackagePlan {
  readonly zipName: string;
  readonly summaryPath: string;
  readonly entries: readonly PlannedEntry[];
}

export function zipFileName(jobNumber: string): string {
  return `${safeName(jobNumber)} – subdivision files.zip`;
}

/** The prototype's safeName on the stem, so a long name never loses its extension. */
export function entryName(name: string): string {
  const ext = /\.[A-Za-z0-9]{1,8}$/.exec(name)?.[0] ?? "";
  return safeName(name.slice(0, name.length - ext.length)) + ext;
}

/** "name.pdf" -> "name (2).pdf", "name" -> "name (2)"; compared case-insensitively like a zip extracted on Windows. */
function uniquePath(used: Set<string>, path: string): string {
  const dot = path.lastIndexOf(".");
  const hasExtension = dot > path.lastIndexOf("/");
  let candidate = path;
  for (let n = 2; used.has(candidate.toLowerCase()); n++) {
    candidate = hasExtension ? `${path.slice(0, dot)} (${n})${path.slice(dot)}` : `${path} (${n})`;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

/**
 * @param files the files that may go in (clean or skipped, not removed, restricted ones only when the caller may see
 *   them), in the order they should appear within a folder
 * @param conditions the job's CURRENT conditions
 */
export function planPackage(
  job: { readonly jobNumber: string; readonly address: string },
  files: readonly PackageFile[],
  conditions: readonly PackageCondition[],
): PackagePlan {
  const top = safeName(jobDisplayText({ ...job, clientName: null, subdivisionType: null }));
  const used = new Set<string>();
  const summaryPath = uniquePath(used, `${top}/Job summary.txt`);
  const entries: PlannedEntry[] = [];
  const add = (file: PackageFile, folder: string) => {
    entries.push({
      file,
      path: uniquePath(used, `${top}/${folder}/${entryName(servedFileName(file.name, file.kind))}`),
    });
  };
  for (const stage of STAGES) {
    // Evidence of the conditions that belong to this stage's agency comes first, as on the page.
    const stageConditions = stage.agency ? conditions.filter((c) => c.agency === stage.agency) : [];
    for (const condition of [...stageConditions].sort((a, b) => a.number - b.number)) {
      const folder = conditionEvidenceFolderName(stage.key, condition.number);
      for (const file of files.filter((f) => f.conditionId === condition.id)) add(file, folder);
    }
    for (const checkpoint of stage.checkpoints) {
      for (const file of files.filter((f) => f.checkpointKey === checkpoint.key)) {
        add(file, checkpointFolderName(stage.key, checkpoint.number, checkpoint.title, file.kind === "email"));
      }
    }
  }
  return { zipName: zipFileName(job.jobNumber), summaryPath, entries };
}

/**
 * Drops the entries whose object is not in storage (`present` holds the keys that are) and names them by their path in
 * the zip without the top folder, for the "files not included" section of Job summary.txt.
 */
export function omitMissing(
  plan: PackagePlan,
  present: ReadonlySet<string>,
): { readonly plan: PackagePlan; readonly missing: readonly string[] } {
  const entries = plan.entries.filter((e) => present.has(e.file.storageKey));
  if (entries.length === plan.entries.length) return { plan, missing: [] };
  const missing = plan.entries
    .filter((e) => !present.has(e.file.storageKey))
    .map((e) => e.path.split("/").slice(1).join("/"));
  return { plan: { ...plan, entries }, missing };
}
