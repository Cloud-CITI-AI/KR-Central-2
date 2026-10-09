import { describe, expect, it } from "vitest";
import { isInRange, perthDateRange } from "./perth-range";

describe("perthDateRange", () => {
  it("runs from 00:00:00 on the first Perth date up to, but not including, 00:00:00 on the day after the last (UTC+8)", () => {
    const range = perthDateRange("2026-09-28", "2026-09-28");
    expect(new Date(range.from ?? NaN).toISOString()).toBe("2026-09-27T16:00:00.000Z");
    expect(new Date(range.to ?? NaN).toISOString()).toBe("2026-09-28T16:00:00.000Z");
  });

  it("leaves an empty or invalid end open", () => {
    expect(perthDateRange("", "")).toEqual({});
    expect(perthDateRange("2026-02-30", "not a date")).toEqual({});
    expect(perthDateRange("2026-09-28", "")).toEqual({ from: Date.parse("2026-09-27T16:00:00Z") });
  });
});

describe("isInRange", () => {
  const range = perthDateRange("2026-09-28", "2026-09-28");

  it("uses the Perth day, not the UTC day", () => {
    expect(isInRange("2026-09-27T15:59:59Z", range)).toBe(false);
    expect(isInRange("2026-09-27T16:00:00Z", range)).toBe(true);
    expect(isInRange("2026-09-28T15:59:59Z", range)).toBe(true);
    expect(isInRange("2026-09-28T16:00:00Z", range)).toBe(false);
  });

  it("keeps an event in the last second of the Perth day, milliseconds included", () => {
    expect(isInRange("2026-09-28T15:59:59.500Z", range)).toBe(true);
    expect(isInRange("2026-09-28T15:59:59.999Z", range)).toBe(true);
    expect(isInRange("2026-09-28T16:00:00.000Z", range)).toBe(false);
  });

  it("accepts everything in an open range", () => {
    expect(isInRange("2020-01-01T00:00:00Z", {})).toBe(true);
  });
});
