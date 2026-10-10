import { describe, expect, it } from "vitest";
import { IsoDate, LongText, ShortText } from "./common.js";

describe("IsoDate", () => {
  it("accepts plausible business dates", () => {
    for (const d of ["1900-01-01", "2026-03-16", "2199-12-31"]) expect(IsoDate.safeParse(d).success).toBe(true);
  });

  it("rejects malformed and impossible dates", () => {
    for (const d of ["2025-02-30", "28/07/2025", "2026-3-1", ""]) expect(IsoDate.safeParse(d).success).toBe(false);
  });

  it("rejects dates outside 1900-01-01..2199-12-31 with a readable message", () => {
    for (const d of ["0001-01-01", "0050-06-15", "1899-12-31", "2200-01-01", "9999-12-31"]) {
      const r = IsoDate.safeParse(d);
      expect(r.success, d).toBe(false);
      expect(r.error?.issues[0]?.message).toBe("Date must be between 1900-01-01 and 2199-12-31");
    }
  });
});

describe("ShortText and LongText", () => {
  it("accept ordinary text, tabs, newlines and emoji", () => {
    expect(ShortText(20).parse("  Lot 12  ")).toBe("Lot 12");
    expect(LongText(50).parse("Line one\nLine\ttwo \u{1F600}")).toBe("Line one\nLine\ttwo \u{1F600}");
    expect(LongText(5).parse("")).toBe("");
  });

  it("refuse a NUL character with a readable message", () => {
    for (const schema of [ShortText(20), LongText(20)]) {
      const r = schema.safeParse("a\u0000b");
      expect(r.success).toBe(false);
      expect(r.error?.issues[0]?.message).toBe("Must not contain NUL (U+0000) characters");
    }
  });
});
