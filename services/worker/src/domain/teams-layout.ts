/**
 * The folder layout the app mirrors into a channel's root folder (ADR-0015 decision 6): the package zip's stage and
 * checkpoint folders (PRODUCT_SPEC §5.8, services/api package-layout.ts) without the zip's top folder, Job summary.txt
 * or the fee proposal (1.0). "Query emails" subfolders exist for checkpoints that take emails; condition evidence
 * folders are planned on demand. SharePoint name rules (V5) are applied on top of the workflow's safeName. Pure.
 */
import {
  STAGES,
  checkpointFolderName,
  conditionEvidenceFolderName,
  safeName,
  slotsOf,
  stageFolderName,
  type CheckpointDefinition,
  type FileKind,
} from "@kr/workflow";
import { servedFileName } from "@kr/storage";

/** SharePoint refuses these in file and folder names; the workflow's safeName already removes most of them. */
// eslint-disable-next-line no-control-regex -- control characters are part of the forbidden set
const FORBIDDEN = /["*:<>?/\\|\u0000-\u001f\u007f]+/g;
/** Names SharePoint reserves (case-insensitive) and prefixes it treats specially. */
const RESERVED = new Set(["forms", "con", "prn", "aux", "nul", ".lock", "desktop.ini", "thumbs.db"]);
const RESERVED_PREFIXES = ["_vti_", "~$"];
export const NAME_MAX = 255;
/** Teams channel folders sit at `/sites/.../Shared Documents/<channel>/…`; keep room under SharePoint's path limit. */
export const PATH_MAX = 400;

/** One segment of a path as SharePoint accepts it: forbidden characters out, no leading/trailing spaces or dots. */
export function sharePointSafe(name: string): string {
  let out = name
    .replace(FORBIDDEN, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/, "");
  if (RESERVED_PREFIXES.some((p) => out.toLowerCase().startsWith(p))) out = out.slice(1);
  if (out.length === 0 || RESERVED.has(out.toLowerCase())) out = "file";
  if (out.length > NAME_MAX) {
    const ext = /\.[A-Za-z0-9]{1,8}$/.exec(out)?.[0] ?? "";
    out = out.slice(0, NAME_MAX - ext.length) + ext;
  }
  return out;
}

/** A relative path with every segment made SharePoint-safe. */
export function sharePointSafePath(path: string): string {
  return path
    .split("/")
    .filter((p) => p.length > 0)
    .map(sharePointSafe)
    .join("/");
}

function takesEmails(checkpoint: CheckpointDefinition): boolean {
  return slotsOf(checkpoint).some((slot) => slot.accept.includes("email"));
}

/** Every folder created up front under the root folder, parents before children, in the zip's order. Never 1.0. */
export function layoutFolders(): string[] {
  const out: string[] = [];
  for (const stage of STAGES) {
    out.push(sharePointSafePath(stageFolderName(stage.key)));
    for (const checkpoint of stage.checkpoints) {
      if (checkpoint.restricted === "fee_proposal") continue;
      const path = sharePointSafePath(checkpointFolderName(stage.key, checkpoint.number, checkpoint.title, false));
      out.push(path);
      if (takesEmails(checkpoint)) out.push(`${path}/Query emails`);
    }
  }
  return out;
}

export interface LayoutFile {
  readonly checkpointKey: string | null;
  readonly conditionId: string | null;
  readonly kind: FileKind;
}

export interface LayoutCondition {
  readonly id: string;
  readonly number: number;
  readonly agency: string;
}

/**
 * The folder (relative to the root folder) a file belongs in, or null when it cannot be placed: an unknown checkpoint,
 * a condition the job no longer has (superseded), or a fee proposal file (never in a job channel, decision 10).
 */
export function targetFolderFor(file: LayoutFile, conditions: readonly LayoutCondition[]): string | null {
  if (file.conditionId !== null) {
    const condition = conditions.find((c) => c.id === file.conditionId);
    if (!condition) return null;
    const stage = STAGES.find((s) => s.agency === condition.agency);
    if (!stage) return null;
    return sharePointSafePath(conditionEvidenceFolderName(stage.key, condition.number));
  }
  if (file.checkpointKey === null) return null;
  for (const stage of STAGES) {
    const checkpoint = stage.checkpoints.find((c) => c.key === file.checkpointKey);
    if (!checkpoint) continue;
    if (checkpoint.restricted === "fee_proposal") return null;
    return sharePointSafePath(
      checkpointFolderName(stage.key, checkpoint.number, checkpoint.title, file.kind === "email"),
    );
  }
  return null;
}

/** The name a file is uploaded under: the zip's served name (extension by sniffed kind), made SharePoint-safe. */
export function remoteNameFor(name: string, kind: FileKind, contentType: string): string {
  const served = servedFileName(name, kind, contentType);
  const ext = /\.[A-Za-z0-9]{1,8}$/.exec(served)?.[0] ?? "";
  return sharePointSafe(safeName(served.slice(0, served.length - ext.length)) + ext);
}

/** "name.pdf" -> "name (2).pdf" until it is free of `taken` (compared case-insensitively, like the zip rule). */
export function uniqueName(taken: Iterable<string>, name: string): string {
  const used = new Set([...taken].map((n) => n.toLowerCase()));
  const dot = name.lastIndexOf(".");
  const hasExtension = dot > 0;
  let candidate = name;
  for (let n = 2; used.has(candidate.toLowerCase()); n += 1) {
    candidate = hasExtension ? `${name.slice(0, dot)} (${n})${name.slice(dot)}` : `${name} (${n})`;
  }
  return candidate;
}

/** The parent paths of a path, shortest first (for creating missing folders): "a/b/c" -> ["a", "a/b"]. */
export function parentPaths(path: string): string[] {
  const parts = path.split("/").filter((p) => p.length > 0);
  return parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join("/"));
}

export function pathTooLong(rootFolder: string, path: string, name: string): boolean {
  return `${rootFolder}/${path}/${name}`.length > PATH_MAX;
}
