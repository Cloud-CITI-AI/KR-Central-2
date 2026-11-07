import { describe, expect, it } from "vitest";
import { createFeatureFlags, staticFlags } from "./flags.js";

describe("createFeatureFlags", () => {
  it("resolves ai-stamp-reading through OpenFeature from the configuration, off by default", async () => {
    const on = await createFeatureFlags({ FEATURE_AI_STAMP_READING: true, FEATURE_TEAMS_FILE_SYNC: false });
    expect(on.isEnabled("ai-stamp-reading")).toBe(true);
    expect(on.isEnabled("teams-file-sync")).toBe(false);
    const off = await createFeatureFlags({ FEATURE_AI_STAMP_READING: false, FEATURE_TEAMS_FILE_SYNC: true });
    expect(off.isEnabled("ai-stamp-reading")).toBe(false);
    expect(off.isEnabled("teams-file-sync")).toBe(true);
  });
});

describe("staticFlags", () => {
  it("answers the given values and treats the rest as off", () => {
    expect(staticFlags({ "ai-stamp-reading": true }).isEnabled("ai-stamp-reading")).toBe(true);
    expect(staticFlags().isEnabled("ai-stamp-reading")).toBe(false);
  });
});
