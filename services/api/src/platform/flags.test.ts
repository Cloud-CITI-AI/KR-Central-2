import { describe, expect, it } from "vitest";
import { FLAG_KEYS, createFeatureFlags, fixedClock, staticFlags, systemClock } from "./flags.js";

describe("feature flags", () => {
  it("exposes exactly the documented keys (docs/flags.md)", () => {
    expect([...FLAG_KEYS]).toEqual(["ai-stamp-reading", "entra-guest-invites"]);
  });
  it("resolves configured values through OpenFeature", async () => {
    const on = await createFeatureFlags({ FEATURE_AI_STAMP_READING: true, FEATURE_ENTRA_GUEST_INVITES: false });
    expect(on.isEnabled("ai-stamp-reading")).toBe(true);
    expect(on.isEnabled("entra-guest-invites")).toBe(false);
    const off = await createFeatureFlags({ FEATURE_AI_STAMP_READING: false, FEATURE_ENTRA_GUEST_INVITES: true });
    expect(off.isEnabled("ai-stamp-reading")).toBe(false);
    expect(off.isEnabled("entra-guest-invites")).toBe(true);
  });
  it("staticFlags defaults every flag to off", () => {
    expect(staticFlags().isEnabled("ai-stamp-reading")).toBe(false);
    expect(staticFlags({ "ai-stamp-reading": true }).isEnabled("ai-stamp-reading")).toBe(true);
  });
});

describe("clocks", () => {
  it("fixedClock returns copies, can be set and advanced", () => {
    const c = fixedClock("2026-03-02T00:00:00Z");
    c.now().setFullYear(1999);
    expect(c.now().toISOString()).toBe("2026-03-02T00:00:00.000Z");
    c.advance(60_000);
    expect(c.now().toISOString()).toBe("2026-03-02T00:01:00.000Z");
    c.set("2027-01-01T00:00:00Z");
    expect(c.now().getUTCFullYear()).toBe(2027);
  });
  it("systemClock reads the wall clock", () => {
    expect(Math.abs(systemClock.now().getTime() - Date.now())).toBeLessThan(1000);
  });
});
