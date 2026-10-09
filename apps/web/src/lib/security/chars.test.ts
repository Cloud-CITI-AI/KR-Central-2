import { describe, expect, it } from "vitest";
import { hasControlChars } from "./chars";

describe("hasControlChars", () => {
  it("detects C0 controls and DEL", () => {
    for (const bad of ["a\nb", "a\u0000b", "a\tb", "a\u007fb"]) expect(hasControlChars(bad)).toBe(true);
  });
  it("accepts printable text including non-ASCII", () => {
    expect(hasControlChars("/jobs/ab c é")).toBe(false);
  });
});
