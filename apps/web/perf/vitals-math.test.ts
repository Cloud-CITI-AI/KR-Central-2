import { describe, expect, it } from "vitest";
import { BUDGETS } from "./budgets";
import {
  cumulativeLayoutShift,
  interactionToNextPaint,
  judge,
  percentile,
  summarise,
  type LayoutShiftEntry,
  type Vitals,
} from "./vitals-math";

const shift = (startTime: number, value: number, hadRecentInput = false): LayoutShiftEntry => ({
  startTime,
  value,
  hadRecentInput,
});
const vitals = (lcpMs: number | null, cls: number, inpMs: number | null): Vitals => ({ lcpMs, cls, inpMs });

describe("cumulativeLayoutShift", () => {
  it("is 0 without shifts and ignores shifts that follow input", () => {
    expect(cumulativeLayoutShift([])).toBe(0);
    expect(cumulativeLayoutShift([shift(100, 0.5, true)])).toBe(0);
  });

  it("adds shifts less than 1 s apart into one window and takes the largest window", () => {
    const shifts = [shift(100, 0.03), shift(900, 0.04), shift(5000, 0.06)];
    expect(cumulativeLayoutShift(shifts)).toBeCloseTo(0.07);
    expect(cumulativeLayoutShift([...shifts, shift(5500, 0.05)])).toBeCloseTo(0.11);
  });

  it("starts a new window after a gap of 1 s, and after 5 s even without a gap", () => {
    expect(cumulativeLayoutShift([shift(0, 0.05), shift(1000, 0.05)])).toBeCloseTo(0.05);
    const chain = [0, 900, 1800, 2700, 3600, 4500, 5400].map((t) => shift(t, 0.01));
    expect(cumulativeLayoutShift(chain)).toBeCloseTo(0.06);
  });
});

describe("interactionToNextPaint", () => {
  it("is null with no interactions (events without an interactionId are not interactions)", () => {
    expect(interactionToNextPaint([])).toBeNull();
    expect(interactionToNextPaint([{ interactionId: 0, startTime: 1, duration: 900 }])).toBeNull();
  });

  it("uses the longest event of each interaction and the worst interaction", () => {
    const events = [
      { interactionId: 1, startTime: 1, duration: 40 },
      { interactionId: 1, startTime: 2, duration: 120 },
      { interactionId: 2, startTime: 3, duration: 80 },
    ];
    expect(interactionToNextPaint(events)).toBe(120);
  });

  it("skips the worst interaction per 50 (the 98th percentile)", () => {
    const events = Array.from({ length: 50 }, (_, i) => ({
      interactionId: i + 1,
      startTime: i,
      duration: i === 0 ? 900 : 100,
    }));
    expect(interactionToNextPaint(events)).toBe(100);
  });
});

describe("summarise and percentile", () => {
  it("takes the last LCP candidate", () => {
    const summary = summarise({ lcpStartTimes: [800, 1500], layoutShifts: [shift(1, 0.02)], events: [] });
    expect(summary).toEqual({ lcpMs: 1500, cls: 0.02, inpMs: null });
    expect(summarise({ lcpStartTimes: [], layoutShifts: [], events: [] }).lcpMs).toBeNull();
  });

  it("is nearest-rank", () => {
    expect(percentile([5, 1, 3, 2, 4], 75)).toBe(4);
    expect(percentile([7], 75)).toBe(7);
    expect(() => percentile([], 75)).toThrow();
  });
});

describe("judge", () => {
  const good = [vitals(1000, 0.01, 50), vitals(1200, 0.02, 80)];

  it("passes samples inside every budget", () => {
    expect(judge(good, BUDGETS)).toMatchObject({ breaches: [], reclaimable: [] });
  });

  it("fails each metric over its budget at p75, with the numbers", () => {
    const { breaches } = judge([vitals(2600, 0.2, 300)], BUDGETS);
    expect(breaches).toEqual(["LCP p75 2600 ms > 2500 ms", "CLS p75 0.200 > 0.100", "INP proxy p75 300 ms > 200 ms"]);
  });

  it("judges the 75th percentile, not the worst or the median", () => {
    const four = [1000, 1000, 1000, 9000].map((lcp) => vitals(lcp, 0, 10));
    expect(judge(four, BUDGETS).breaches).toEqual([]);
    expect(judge([...four, vitals(9000, 0, 10)], BUDGETS).breaches).toHaveLength(1);
  });

  it("fails when a metric was never reported", () => {
    expect(judge([vitals(null, 0, null)], BUDGETS).breaches).toEqual([
      "LCP was never reported",
      "INP proxy was never reported",
    ]);
  });

  it("holds a known breach to its ceiling and says when the ceiling is no longer needed", () => {
    const ceilings = { lcpMs: 4000, cls: 0.5 };
    expect(judge([vitals(3900, 0.4, 10)], BUDGETS, ceilings).breaches).toEqual([]);
    expect(judge([vitals(4100, 0.4, 10)], BUDGETS, ceilings).breaches).toEqual([
      "LCP p75 4100 ms > 4000 ms (known-breach ceiling; budget 2500 ms)",
    ]);
    expect(judge([vitals(2000, 0.4, 10)], BUDGETS, ceilings).reclaimable).toEqual([
      "LCP p75 2000 ms fits its budget 2500 ms this run: remove its KNOWN_BREACHES entry if it keeps doing so",
    ]);
  });
});
