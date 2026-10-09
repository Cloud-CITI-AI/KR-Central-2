import { describe, expect, it } from "vitest";
import { nightlyKey, preMigrateKey, safeRelease, stampOfKey, utcStamp } from "./keys.js";

const at = new Date("2026-10-09T07:01:02.345Z");

describe("backup keys", () => {
  it("formats a UTC stamp without separators or milliseconds", () => {
    expect(utcStamp(at)).toBe("20261009T070102Z");
  });

  it("names the pre-migration dump after the time and release", () => {
    expect(preMigrateKey(at, "v1.4.0")).toBe("db/pre-migrate/20261009T070102Z-v1.4.0.dump");
  });

  it("names the nightly dump after the time", () => {
    expect(nightlyKey(at)).toBe("db/nightly/20261009T070102Z.dump");
  });

  it("keeps only key-safe characters of a release label, and never returns an empty one", () => {
    expect(safeRelease("feature/x y")).toBe("feature_x_y");
    expect(safeRelease("")).toBe("unknown");
    expect(safeRelease("a".repeat(100))).toHaveLength(64);
  });

  it("reads the time back from a dump key", () => {
    expect(stampOfKey(preMigrateKey(at, "dev"))).toEqual(new Date("2026-10-09T07:01:02Z"));
    expect(stampOfKey(nightlyKey(at))).toEqual(new Date("2026-10-09T07:01:02Z"));
  });

  it("rejects keys that are not stamped, including impossible dates", () => {
    expect(stampOfKey("db/nightly/readme.txt")).toBeUndefined();
    expect(stampOfKey("db/nightly/20261399T070102Z.dump")).toBeUndefined();
  });
});
