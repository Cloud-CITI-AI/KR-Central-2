import type { TeamsSettingsRow } from "@kr/db";
import { describe, expect, it } from "vitest";
import { planSettingsUpdate } from "./settings-update.js";

const row: TeamsSettingsRow = {
  singleton: true,
  team_id: null,
  team_site_url: null,
  team_name: null,
  fee_channel_id: null,
  fee_site_url: null,
  root_folder: "102. Subdivision Tracker",
  fee_proposal_policy: "exclude",
  sync_enabled: false,
  inbound_sync_enabled: false,
  create_channels_enabled: false,
  inbound_poll_seconds: 300,
  updated_by: null,
  updated_at: new Date("2026-11-06T00:00:00Z"),
  version: 1,
};
const body = {
  teamId: null,
  teamSiteUrl: null,
  feeChannelLink: null,
  feeSiteUrl: null,
  rootFolder: "102. Subdivision Tracker",
  feeProposalPolicy: "exclude" as const,
  syncEnabled: false,
  inboundSyncEnabled: false,
  createChannelsEnabled: false,
  inboundPollSeconds: 300,
};
const TEAM = "11111111-2222-4333-8444-555555555555";

describe("planSettingsUpdate", () => {
  it("is a no-op when nothing changes", () => {
    const plan = planSettingsUpdate(row, body, null);
    expect(plan.isNoOp).toBe(true);
    expect(plan.changes).toBeNull();
  });

  it("reports every changed field by its column name and clears the team name when the team changes", () => {
    const named = { ...row, team_id: "00000000-0000-4000-8000-000000000000", team_name: "Old team" };
    const plan = planSettingsUpdate(
      named,
      { ...body, teamId: TEAM, teamSiteUrl: "https://contoso.sharepoint.com/sites/TeamSurvey", syncEnabled: true },
      null,
    );
    expect(plan.isNoOp).toBe(false);
    expect(plan.changes).toEqual({
      team_id: { from: "00000000-0000-4000-8000-000000000000", to: TEAM },
      team_site_url: { from: null, to: "https://contoso.sharepoint.com/sites/TeamSurvey" },
      sync_enabled: { from: false, to: true },
    });
    expect(plan.set.team_name).toBeNull();
  });

  it("keeps the team name when only other fields change and stores the parsed fee channel id", () => {
    const named = { ...row, team_id: TEAM, team_name: "Team Survey" };
    const plan = planSettingsUpdate(
      named,
      { ...body, teamId: TEAM, feeChannelLink: "https://…" },
      "19:fee@thread.tacv2",
    );
    expect(plan.set.team_name).toBeUndefined();
    expect(plan.changes).toEqual({ fee_channel_id: { from: null, to: "19:fee@thread.tacv2" } });
  });
});
