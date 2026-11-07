/** A job's Teams link as the tracker panel shows it (contract TeamsLink, PRODUCT_SPEC §5.10). Pure. */
import type { TeamsLink } from "@kr/contracts";
import type { JobTeamsLinkRow, TeamsPushStatusValue, TeamsSettingsRow } from "@kr/db";

export interface LinkViewInput {
  readonly jobId: string;
  readonly settings: Pick<
    TeamsSettingsRow,
    "sync_enabled" | "fee_proposal_policy" | "fee_site_url" | "root_folder" | "inbound_sync_enabled"
  >;
  readonly link: JobTeamsLinkRow | null;
  readonly linkedBy: { id: string; displayName: string } | null;
  readonly counts: Readonly<Record<TeamsPushStatusValue, number>> | null;
  readonly unfiled?: number;
  readonly provisioningOperationId: string | null;
  readonly canLink: boolean;
  readonly canViewFeeProposal: boolean;
  /** The job number as the Fee Proposals subfolder is named (25-j); null until that PR lands. */
  readonly feeFolderName: string | null;
  /** The newest channel-creation task (phase 3), for the not-created state when the job has no link. */
  readonly createAttempt?: { status: string; errorCode: string | null; resultErrorCode: string | null } | null;
  readonly createEnabled?: boolean;
}

const NO_COUNTS = { pending: 0, uploading: 0, pushed: 0, excluded: 0, failed: 0, deleting: 0, deleted: 0 } as const;

export function linkState(input: Pick<LinkViewInput, "settings" | "link" | "createAttempt">): TeamsLink["state"] {
  if (!input.settings.sync_enabled) return "sync_off";
  if (!input.link) {
    const a = input.createAttempt;
    if (a && (a.status === "queued" || a.status === "running")) return "provisioning";
    if (a && (a.status === "failed" || a.resultErrorCode !== null)) return "not_created";
    return "not_linked";
  }
  return input.link.status;
}

/** The code shown for a failed creation: the task's error, or the error inside its result (`channel_name_taken`). */
export function createErrorCode(a: LinkViewInput["createAttempt"]): string | null {
  if (!a) return null;
  return a.resultErrorCode ?? a.errorCode;
}

export function feeProposalFolderUrl(
  input: Pick<LinkViewInput, "settings" | "canViewFeeProposal" | "feeFolderName">,
): string | null {
  if (!input.canViewFeeProposal || input.settings.fee_proposal_policy !== "restricted") return null;
  if (!input.settings.fee_site_url || !input.feeFolderName) return null;
  const site = input.settings.fee_site_url.replace(/\/+$/, "");
  return `${site}/Shared%20Documents/Fee%20Proposals/${encodeURIComponent(input.feeFolderName)}`;
}

export function toTeamsLink(input: LinkViewInput): TeamsLink {
  const { link } = input;
  const counts = input.counts ?? NO_COUNTS;
  return {
    jobId: input.jobId,
    state: linkState(input),
    channelName: link?.channel_name ?? null,
    teamsUrl: link?.teams_url ?? null,
    sharePointUrl: link?.sharepoint_url ?? null,
    linkedBy: link ? input.linkedBy : null,
    linkedAt: link ? link.linked_at.toISOString() : null,
    lastPushAt: link?.last_push_at ? link.last_push_at.toISOString() : null,
    counts: {
      pushed: counts.pushed,
      // an upload in flight is still waiting from the person's point of view
      pending: counts.pending + counts.uploading,
      failed: counts.failed,
      excluded: counts.excluded,
      unfiled: input.unfiled ?? 0,
    },
    errorCode: link ? (link.status === "error" ? link.error_code : null) : createErrorCode(input.createAttempt),
    operationId: link?.status === "provisioning" ? input.provisioningOperationId : null,
    lastPollAt: link?.last_poll_at ? link.last_poll_at.toISOString() : null,
    inboundSyncEnabled: input.settings.inbound_sync_enabled,
    feeProposalPolicy: input.settings.fee_proposal_policy,
    feeProposalFolderUrl: feeProposalFolderUrl(input),
    canLink: input.canLink,
    createEnabled: input.createEnabled ?? false,
    version: link?.version ?? null,
  };
}
