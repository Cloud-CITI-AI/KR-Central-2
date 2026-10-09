import { describe, expect, it } from "vitest";
import { createFeatureFlags, staticFlags } from "./flags.js";

describe("createFeatureFlags", () => {
  it("resolves ai-stamp-reading through OpenFeature from the configuration, off by default", async () => {
    expect((await createFeatureFlags({ FEATURE_AI_STAMP_READING: true })).isEnabled("ai-stamp-reading")).toBe(true);
    expect((await createFeatureFlags({ FEATURE_AI_STAMP_READING: false })).isEnabled("ai-stamp-reading")).toBe(false);
  });
});

describe("staticFlags", () => {
  it("answers the given values and treats the rest as off", () => {
    expect(staticFlags({ "ai-stamp-reading": true }).isEnabled("ai-stamp-reading")).toBe(true);
    expect(staticFlags().isEnabled("ai-stamp-reading")).toBe(false);
  });
});
