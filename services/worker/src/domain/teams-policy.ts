/**
 * Which files leave the app for Teams (ADR-0015 decisions 7 and 10). Pure.
 * `sync`: copied into the job channel; `exclude`: never copied; `restricted`: fee proposal (1.0) files under the
 * `restricted` policy, which go only to the private Fee Proposals channel (PR 25-j) and never into a job channel.
 */
import { getCheckpoint } from "@kr/workflow";
import type { FeeProposalPolicyValue, ScanStatusValue, TeamsLinkStatusValue } from "@kr/db";

export type SyncPolicy = "sync" | "exclude" | "restricted";

export function syncPolicyFor(
  checkpointKey: string | null,
  settings: { readonly fee_proposal_policy: FeeProposalPolicyValue },
): SyncPolicy {
  if (checkpointKey === null) return "sync";
  let restricted: string | undefined;
  try {
    restricted = getCheckpoint(checkpointKey).restricted;
  } catch {
    return "exclude";
  }
  if (restricted !== "fee_proposal") return "sync";
  return settings.fee_proposal_policy === "restricted" ? "restricted" : "exclude";
}

export interface PushableFile {
  readonly scan_status: ScanStatusValue;
  readonly deleted_at: Date | null;
  readonly purged_at: Date | null;
  readonly checkpoint_key: string | null;
}

/** `channel`: the job channel's root folder; `fee`: the job's subfolder in the private Fee Proposals channel (PR 25-j). */
export type PushTarget = "channel" | "fee";
export type PushDecision =
  { readonly push: true; readonly target: PushTarget } | { readonly push: false; readonly reason: PushSkipReason };
export type PushSkipReason =
  "sync_off" | "link_not_ready" | "job_archived" | "not_clean" | "file_removed" | "policy_exclude" | "fee_site_missing";

/**
 * Whether a file may be copied now (decisions 7 and 10): clean (never skipped), present, job live, link ready; a
 * fee-proposal file goes to the Fee Proposals site under `restricted` and nowhere under `exclude`.
 */
export function pushDecision(input: {
  readonly file: PushableFile;
  readonly link: { readonly status: TeamsLinkStatusValue } | null;
  readonly settings: {
    readonly sync_enabled: boolean;
    readonly fee_proposal_policy: FeeProposalPolicyValue;
    readonly fee_site_url?: string | null;
  };
  readonly jobArchived: boolean;
}): PushDecision {
  if (!input.settings.sync_enabled) return { push: false, reason: "sync_off" };
  if (input.link?.status !== "ready") return { push: false, reason: "link_not_ready" };
  if (input.jobArchived) return { push: false, reason: "job_archived" };
  if (input.file.deleted_at !== null || input.file.purged_at !== null) return { push: false, reason: "file_removed" };
  if (input.file.scan_status !== "clean") return { push: false, reason: "not_clean" };
  const policy = syncPolicyFor(input.file.checkpoint_key, input.settings);
  if (policy === "exclude") return { push: false, reason: "policy_exclude" };
  if (policy === "restricted") {
    return input.settings.fee_site_url ? { push: true, target: "fee" } : { push: false, reason: "fee_site_missing" };
  }
  return { push: true, target: "channel" };
}

/** Whether an item found in the target folder after a crash is the app's own half-finished upload (decision 8). */
export function adoptable(
  item: { readonly size: number | null; readonly createdByAppId: string | null; readonly isFolder: boolean },
  expected: { readonly sizeBytes: number; readonly appId: string },
): boolean {
  return !item.isFolder && item.size === expected.sizeBytes && item.createdByAppId === expected.appId;
}
