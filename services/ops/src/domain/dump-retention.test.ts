import { describe, expect, it } from "vitest";
import { planDumpPruning } from "./dump-retention.js";

const now = new Date("2026-10-09T18:15:00Z");
const nightly = (stamp: string): string => `db/nightly/${stamp}.dump`;
const pre = (stamp: string, release = "v1"): string => `db/pre-migrate/${stamp}-${release}.dump`;

describe("planDumpPruning", () => {
  it("deletes dumps older than the retention period and keeps the rest", () => {
    const keys = [
      nightly("20260801T181500Z"),
      nightly("20260904T181500Z"),
      nightly("20260905T181500Z"),
      nightly("20261008T181500Z"),
    ];
    // 35 days before 2026-10-09T18:15Z is 2026-09-04T18:15Z: that dump is exactly at the limit and stays.
    expect(planDumpPruning(keys, now, 35).delete).toEqual([nightly("20260801T181500Z")]);
  });

  it("prunes nightly and pre-migration dumps independently", () => {
    const keys = [
      nightly("20260701T181500Z"),
      nightly("20261008T181500Z"),
      pre("20260702T010000Z"),
      pre("20260703T010000Z"),
    ];
    const plan = planDumpPruning(keys, now, 35);
    expect(plan.delete).toEqual([nightly("20260701T181500Z"), pre("20260702T010000Z")]);
    // The newest pre-migration dump is old, but it is the only recovery point of its kind: it stays.
    expect(plan.delete).not.toContain(pre("20260703T010000Z"));
  });

  it("never deletes the newest dump of a prefix, however old", () => {
    expect(planDumpPruning([nightly("20250101T000000Z"), nightly("20250102T000000Z")], now, 35).delete).toEqual([
      nightly("20250101T000000Z"),
    ]);
  });

  it("leaves keys it cannot date alone and reports them", () => {
    const plan = planDumpPruning(
      ["db/nightly/notes.txt", nightly("20260101T000000Z"), nightly("20261008T000000Z")],
      now,
      35,
    );
    expect(plan.delete).toEqual([nightly("20260101T000000Z")]);
    expect(plan.unrecognised).toEqual(["db/nightly/notes.txt"]);
  });

  it("has nothing to do for an empty listing", () => {
    expect(planDumpPruning([], now, 35)).toEqual({ delete: [], unrecognised: [] });
  });
});
