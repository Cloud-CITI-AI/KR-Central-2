import { describe, expect, it } from "vitest";
import { formatMegabytes } from "./format";

describe("formatMegabytes", () => {
  it.each([
    [52_428_800, "50"],
    [13_107_200, "12.5"],
    [1_048_576, "1"],
    [1_000_000, "1"],
  ])("%i bytes -> %s", (bytes, text) => {
    expect(formatMegabytes(bytes)).toBe(text);
  });
});
