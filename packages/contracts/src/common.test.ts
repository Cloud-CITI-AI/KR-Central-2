import { describe, expect, it } from "vitest";
import { IsoDate } from "./common.js";

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
