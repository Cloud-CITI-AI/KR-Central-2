import { describe, expect, it } from "vitest";
import {
  decodeAuditCursor,
  encodeAuditCursor,
  occurredRange,
  prefixPattern,
  startOfBusinessDay,
} from "./audit-filters.js";

describe("Perth dates to UTC", () => {
  it("a Perth day starts at 16:00 UTC the day before", () => {
    expect(startOfBusinessDay("2026-03-02").toISOString()).toBe("2026-03-01T16:00:00.000Z");
    expect(startOfBusinessDay("2026-01-01").toISOString()).toBe("2025-12-31T16:00:00.000Z");
  });

  it("includes the whole last day: the upper bound is the start of the next Perth day", () => {
    const r = occurredRange("2026-03-02", "2026-03-02");
    expect([r?.from?.toISOString(), r?.before?.toISOString()]).toEqual([
      "2026-03-01T16:00:00.000Z",
      "2026-03-02T16:00:00.000Z",
    ]);
  });

  it("allows an open end and rejects bad or reversed dates", () => {
    expect(occurredRange(undefined, undefined)).toEqual({ from: null, before: null });
    expect(occurredRange(undefined, "2026-03-02")?.from).toBeNull();
    expect(occurredRange("2026-03-03", "2026-03-02")).toBeNull();
    expect(occurredRange("2026-02-30", undefined)).toBeNull();
    expect(occurredRange(undefined, "yesterday")).toBeNull();
  });
});

describe("prefixPattern and the cursor", () => {
  it("escapes LIKE wildcards in an action prefix", () => {
    expect(prefixPattern("access_grant.")).toBe("access\\_grant.%");
    expect(prefixPattern("100%\\")).toBe("100\\%\\\\%");
  });

  it("round-trips an id and rejects anything that is not a canonical bigint", () => {
    expect(decodeAuditCursor(encodeAuditCursor("12345"))).toBe("12345");
    for (const bad of [
      "",
      "!!!",
      encodeAuditCursor("0"),
      encodeAuditCursor("12x"),
      encodeAuditCursor("-5"),
      encodeAuditCursor("1".repeat(25)),
    ]) {
      expect(decodeAuditCursor(bad)).toBeNull();
    }
  });
});
