/** The teams_settings row as the API shows it (contract TeamsSettings). Pure. */
import type { TeamsSettings, UserRef } from "@kr/contracts";
import type { OperationRow, TeamsSettingsRow } from "@kr/db";
import { buildTeamsUrl } from "./channel-link.js";

export const FEE_CHANNEL_NAME = "Fee Proposals";

export interface SettingsViewInput {
  readonly row: TeamsSettingsRow;
  readonly updatedBy: UserRef | null;
  /** The newest `teams.check` operation, if any. */
  readonly lastCheck: Pick<OperationRow, "id" | "status" | "created_at"> | null;
  readonly tenantId: string;
}

export function feeChannelLinkOf(
  row: Pick<TeamsSettingsRow, "team_id" | "fee_channel_id">,
  tenantId: string,
): string | null {
  if (!row.team_id || !row.fee_channel_id) return null;
  return buildTeamsUrl({
    channelId: row.fee_channel_id,
    channelName: FEE_CHANNEL_NAME,
    groupId: row.team_id,
    tenantId,
  });
}

export function toTeamsSettings({ row, updatedBy, lastCheck, tenantId }: SettingsViewInput): TeamsSettings {
  return {
    teamId: row.team_id,
    teamSiteUrl: row.team_site_url,
    teamName: row.team_name,
    feeChannelId: row.fee_channel_id,
    feeChannelLink: feeChannelLinkOf(row, tenantId),
    feeSiteUrl: row.fee_site_url,
    rootFolder: row.root_folder,
    feeProposalPolicy: row.fee_proposal_policy,
    syncEnabled: row.sync_enabled,
    inboundSyncEnabled: row.inbound_sync_enabled,
    createChannelsEnabled: row.create_channels_enabled,
    inboundPollSeconds: row.inbound_poll_seconds,
    updatedBy,
    updatedAt: row.updated_at.toISOString(),
    version: row.version,
    lastCheck: lastCheck
      ? { operationId: lastCheck.id, status: lastCheck.status, startedAt: lastCheck.created_at.toISOString() }
      : null,
  };
}
