import type { JobTeamsLinkRow } from "@kr/db";
import { describe, expect, it } from "vitest";
import { feeProposalFolderUrl, linkState, toTeamsLink, type LinkViewInput } from "./link-view.js";

const JOB = "0f8fad5b-d9cb-469f-a165-70867728950e";
const link: JobTeamsLinkRow = {
  job_id: JOB,
  team_id: "11111111-2222-4333-8444-555555555555",
  team_site_url: "https://contoso.sharepoint.com/sites/TeamSurvey",
  channel_id: "19:abc@thread.tacv2",
  channel_name: "S-0042_1 EXAMPLE RD, SUBURB (CLIENT)",
  status: "ready",
  drive_id: "b!drive",
  channel_folder_item_id: "01CHANNEL",
  root_folder_item_id: "01ROOT",
  sharepoint_url: "https://contoso.sharepoint.com/sites/TeamSurvey/Shared%20Documents/S-0042",
  teams_url: "https://teams.microsoft.com/l/channel/19%3Aabc%40thread.tacv2/S-0042?groupId=x&tenantId=y",
  error_code: null,
  linked_by: "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1",
  linked_at: new Date("2026-11-06T01:00:00Z"),
  provisioned_at: new Date("2026-11-06T01:01:00Z"),
  last_push_at: new Date("2026-11-06T01:02:00Z"),
  last_poll_at: null,
  delta_token: null,
  version: 2,
};
const settings = {
  sync_enabled: true,
  inbound_sync_enabled: false,
  fee_proposal_policy: "exclude" as const,
  fee_site_url: null,
  root_folder: "102. Subdivision Tracker",
};
const base: LinkViewInput = {
  jobId: JOB,
  settings,
  link,
  linkedBy: { id: link.linked_by ?? "", displayName: "Ada Admin" },
  counts: { pending: 1, uploading: 2, pushed: 3, excluded: 4, failed: 5, deleting: 0, deleted: 0 },
  provisioningOperationId: null,
  canLink: true,
  canViewFeeProposal: false,
  feeFolderName: null,
};

describe("linkState", () => {
  it("is sync_off whenever copying is switched off, whatever the link says", () => {
    expect(linkState({ settings: { ...settings, sync_enabled: false }, link })).toBe("sync_off");
    expect(linkState({ settings: { ...settings, sync_enabled: false }, link: null })).toBe("sync_off");
  });
  it("follows the link otherwise", () => {
    expect(linkState({ settings, link: null })).toBe("not_linked");
    expect(linkState({ settings, link: { ...link, status: "provisioning" } })).toBe("provisioning");
    expect(linkState({ settings, link: { ...link, status: "error" } })).toBe("error");
  });
});

describe("toTeamsLink", () => {
  it("maps a ready link, folding uploads in flight into pending", () => {
    expect(toTeamsLink(base)).toEqual({
      jobId: JOB,
      state: "ready",
      channelName: link.channel_name,
      teamsUrl: link.teams_url,
      sharePointUrl: link.sharepoint_url,
      linkedBy: { id: link.linked_by, displayName: "Ada Admin" },
      linkedAt: "2026-11-06T01:00:00.000Z",
      lastPushAt: "2026-11-06T01:02:00.000Z",
      counts: { pushed: 3, pending: 3, failed: 5, excluded: 4, unfiled: 0 },
      errorCode: null,
      operationId: null,
      lastPollAt: null,
      inboundSyncEnabled: false,
      feeProposalPolicy: "exclude",
      feeProposalFolderUrl: null,
      canLink: true,
      createEnabled: false,
      version: 2,
    });
  });
  it("shows the error code only in error and the task only while provisioning", () => {
    const err = toTeamsLink({ ...base, link: { ...link, status: "error", error_code: "channel_folder_missing" } });
    expect(err.errorCode).toBe("channel_folder_missing");
    const prov = toTeamsLink({
      ...base,
      link: { ...link, status: "provisioning", error_code: "stale" },
      provisioningOperationId: "7d444840-9dc0-41b4-a5c2-3a8e7f1d2b9c",
    });
    expect(prov.errorCode).toBeNull();
    expect(prov.operationId).toBe("7d444840-9dc0-41b4-a5c2-3a8e7f1d2b9c");
  });
  it("is empty for an unlinked job", () => {
    expect(toTeamsLink({ ...base, link: null, linkedBy: null, counts: null })).toMatchObject({
      state: "not_linked",
      channelName: null,
      counts: { pushed: 0, pending: 0, failed: 0, excluded: 0, unfiled: 0 },
      version: null,
    });
  });
});

describe("feeProposalFolderUrl", () => {
  const restricted = {
    ...settings,
    fee_proposal_policy: "restricted" as const,
    fee_site_url: "https://contoso.sharepoint.com/sites/TeamSurvey-FeeProposals/",
  };
  it("links the job's subfolder only for fee viewers under the restricted policy", () => {
    expect(feeProposalFolderUrl({ settings: restricted, canViewFeeProposal: true, feeFolderName: "S-0042" })).toBe(
      "https://contoso.sharepoint.com/sites/TeamSurvey-FeeProposals/Shared%20Documents/Fee%20Proposals/S-0042",
    );
    expect(
      feeProposalFolderUrl({ settings: restricted, canViewFeeProposal: false, feeFolderName: "S-0042" }),
    ).toBeNull();
    expect(feeProposalFolderUrl({ settings, canViewFeeProposal: true, feeFolderName: "S-0042" })).toBeNull();
    expect(feeProposalFolderUrl({ settings: restricted, canViewFeeProposal: true, feeFolderName: null })).toBeNull();
  });

  it("reports a failed channel creation as not_created with its code, and a running one as provisioning (phase 3)", () => {
    const base2 = { ...base, link: null, linkedBy: null, counts: null };
    expect(
      toTeamsLink({
        ...base2,
        createAttempt: { status: "failed", errorCode: "graph_unavailable", resultErrorCode: null },
      }),
    ).toMatchObject({
      state: "not_created",
      errorCode: "graph_unavailable",
    });
    expect(
      toTeamsLink({
        ...base2,
        createAttempt: { status: "succeeded", errorCode: null, resultErrorCode: "channel_name_taken" },
      }),
    ).toMatchObject({
      state: "not_created",
      errorCode: "channel_name_taken",
    });
    expect(
      toTeamsLink({ ...base2, createAttempt: { status: "queued", errorCode: null, resultErrorCode: null } }).state,
    ).toBe("provisioning");
    expect(
      toTeamsLink({ ...base2, createAttempt: { status: "succeeded", errorCode: null, resultErrorCode: null } }).state,
    ).toBe("not_linked");
  });
});
