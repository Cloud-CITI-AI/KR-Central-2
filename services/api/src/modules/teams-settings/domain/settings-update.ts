/**
 * What a PUT of the Teams settings changes (PRODUCT_SPEC §9.3). Pure: the route parses and checks the fee channel link
 * first and passes its channel id here. Every changed field is reported for the audit entry; a changed team clears the
 * display name until the next Test connection fills it again.
 */
import type { UpdateTeamsSettingsRequest } from "@kr/contracts";
import { diffChanges, type AuditChanges, type TeamsSettingsRow, type TeamsSettingsUpdate } from "@kr/db";

export interface SettingsUpdatePlan {
  readonly set: TeamsSettingsUpdate;
  readonly changes: AuditChanges | null;
  readonly isNoOp: boolean;
}

const AUDITED = [
  "team_id",
  "team_site_url",
  "fee_channel_id",
  "fee_site_url",
  "root_folder",
  "fee_proposal_policy",
  "sync_enabled",
  "inbound_sync_enabled",
  "create_channels_enabled",
  "inbound_poll_seconds",
] as const;

export function planSettingsUpdate(
  current: TeamsSettingsRow,
  body: UpdateTeamsSettingsRequest,
  feeChannelId: string | null,
): SettingsUpdatePlan {
  const next = {
    team_id: body.teamId,
    team_site_url: body.teamSiteUrl,
    fee_channel_id: feeChannelId,
    fee_site_url: body.feeSiteUrl,
    root_folder: body.rootFolder,
    fee_proposal_policy: body.feeProposalPolicy,
    sync_enabled: body.syncEnabled,
    inbound_sync_enabled: body.inboundSyncEnabled,
    create_channels_enabled: body.createChannelsEnabled,
    inbound_poll_seconds: body.inboundPollSeconds,
  } satisfies TeamsSettingsUpdate;
  const before = Object.fromEntries(AUDITED.map((k) => [k, current[k]]));
  const changes = diffChanges(before, next);
  const teamChanged = next.team_id !== current.team_id;
  return {
    set: { ...next, ...(teamChanged ? { team_name: null } : {}) },
    changes,
    isNoOp: changes === null,
  };
}
