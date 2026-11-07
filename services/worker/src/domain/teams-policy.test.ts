import { describe, expect, it } from "vitest";
import { adoptable, pushDecision, syncPolicyFor } from "./teams-policy.js";

const on = { sync_enabled: true, fee_proposal_policy: "exclude" as const };
const file = { scan_status: "clean" as const, deleted_at: null, purged_at: null, checkpoint_key: "i2_0" };
const ready = { status: "ready" as const };

describe("syncPolicyFor", () => {
  it("syncs every checkpoint but the fee proposal, which follows the policy", () => {
    expect(syncPolicyFor("i2_0", on)).toBe("sync");
    expect(syncPolicyFor(null, on)).toBe("sync");
    expect(syncPolicyFor("i1_0p", on)).toBe("exclude");
    expect(syncPolicyFor("i1_0p", { fee_proposal_policy: "restricted" })).toBe("restricted");
    expect(syncPolicyFor("unknown", on)).toBe("exclude");
  });
});

describe("pushDecision", () => {
  it("pushes a clean file of a live, linked job while copying is on", () => {
    expect(pushDecision({ file, link: ready, settings: on, jobArchived: false })).toEqual({
      push: true,
      target: "channel",
    });
  });
  it.each([
    ["sync_off", { file, link: ready, settings: { ...on, sync_enabled: false }, jobArchived: false }],
    ["link_not_ready", { file, link: { status: "provisioning" as const }, settings: on, jobArchived: false }],
    ["link_not_ready", { file, link: null, settings: on, jobArchived: false }],
    ["job_archived", { file, link: ready, settings: on, jobArchived: true }],
    [
      "file_removed",
      {
        file: { ...file, deleted_at: new Date("2026-11-06T00:00:00Z") },
        link: ready,
        settings: on,
        jobArchived: false,
      },
    ],
    [
      "not_clean",
      { file: { ...file, scan_status: "skipped" as const }, link: ready, settings: on, jobArchived: false },
    ],
    [
      "not_clean",
      { file: { ...file, scan_status: "pending" as const }, link: ready, settings: on, jobArchived: false },
    ],
    ["policy_exclude", { file: { ...file, checkpoint_key: "i1_0p" }, link: ready, settings: on, jobArchived: false }],
    [
      "fee_site_missing",
      {
        file: { ...file, checkpoint_key: "i1_0p" },
        link: ready,
        settings: { ...on, fee_proposal_policy: "restricted" as const, fee_site_url: null },
        jobArchived: false,
      },
    ],
  ])("refuses with %s", (reason, input) => {
    expect(pushDecision(input)).toEqual({ push: false, reason });
  });
  it("sends a fee-proposal file to the Fee Proposals site under the restricted policy (never the job channel)", () => {
    expect(
      pushDecision({
        file: { ...file, checkpoint_key: "i1_0p" },
        link: ready,
        settings: {
          ...on,
          fee_proposal_policy: "restricted",
          fee_site_url: "https://contoso.sharepoint.com/sites/Fee",
        },
        jobArchived: false,
      }),
    ).toEqual({ push: true, target: "fee" });
  });
});

describe("adoptable", () => {
  it("adopts only a file of the same size created by this app", () => {
    const expected = { sizeBytes: 10, appId: "app" };
    expect(adoptable({ size: 10, createdByAppId: "app", isFolder: false }, expected)).toBe(true);
    expect(adoptable({ size: 11, createdByAppId: "app", isFolder: false }, expected)).toBe(false);
    expect(adoptable({ size: 10, createdByAppId: "person", isFolder: false }, expected)).toBe(false);
    expect(adoptable({ size: 10, createdByAppId: "app", isFolder: true }, expected)).toBe(false);
  });
});
