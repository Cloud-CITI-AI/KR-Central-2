import { describe, expect, it } from "vitest";
import { planChannelForNewJob } from "./channel-plan.js";

const now = new Date("2026-11-06T02:00:00Z");
const settings = { sync_enabled: true, create_channels_enabled: true, team_id: "11111111-2222-4333-8444-555555555555" };
const job = { jobNumber: "0042", address: "1 Example Rd, Suburb", clientName: "Client" };
const fresh = { cachedAt: new Date("2026-11-06T01:30:00Z"), nameTaken: () => false };

describe("planChannelForNewJob", () => {
  it("creates with the generated name when everything is on and the cache is fresh", () => {
    expect(planChannelForNewJob({ flagOn: true, settings, requested: undefined, job, cache: fresh, now })).toEqual({
      kind: "create",
      name: "S-0042_1 EXAMPLE RD, SUBURB (Client)",
    });
  });
  it("does nothing when the flag, copying or channel creation is off, no team is set, or the person unticked the box", () => {
    expect(planChannelForNewJob({ flagOn: false, settings, requested: true, job, cache: fresh, now })).toEqual({
      kind: "none",
    });
    expect(
      planChannelForNewJob({
        flagOn: true,
        settings: { ...settings, create_channels_enabled: false },
        requested: true,
        job,
        cache: fresh,
        now,
      }),
    ).toEqual({ kind: "none" });
    expect(
      planChannelForNewJob({
        flagOn: true,
        settings: { ...settings, team_id: null },
        requested: true,
        job,
        cache: fresh,
        now,
      }),
    ).toEqual({ kind: "none" });
    expect(planChannelForNewJob({ flagOn: true, settings, requested: false, job, cache: fresh, now })).toEqual({
      kind: "none",
    });
  });
  it("refuses a name the cache already holds, and creates unchecked when the cache is empty or stale", () => {
    expect(
      planChannelForNewJob({
        flagOn: true,
        settings,
        requested: true,
        job,
        cache: { ...fresh, nameTaken: () => true },
        now,
      }),
    ).toEqual({
      kind: "refuse",
      name: "S-0042_1 EXAMPLE RD, SUBURB (Client)",
    });
    expect(
      planChannelForNewJob({
        flagOn: true,
        settings,
        requested: true,
        job,
        cache: { cachedAt: null, nameTaken: () => true },
        now,
      }),
    ).toMatchObject({ kind: "create_unchecked" });
    expect(
      planChannelForNewJob({
        flagOn: true,
        settings,
        requested: true,
        job,
        cache: { cachedAt: new Date("2026-11-05T00:00:00Z"), nameTaken: () => true },
        now,
      }),
    ).toMatchObject({ kind: "create_unchecked" });
  });
});
