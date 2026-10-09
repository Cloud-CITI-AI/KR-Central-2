import { describe, expect, it } from "vitest";
import { safeReturnTo } from "./return-to";

describe("safeReturnTo", () => {
  it.each(["/", "/jobs/abc?stage=wapc#checkpoint-i5_0", "/admin/users"])("keeps the same-origin path %s", (path) => {
    expect(safeReturnTo(path)).toBe(path);
  });

  it.each([
    "//evil.example.com",
    "https://evil.example.com/",
    "javascript:alert(1)",
    "/\\evil.example.com",
    "/ x",
    "/a\nb",
    "/a\u0000b",
    "evil",
    "",
    `/${"a".repeat(512)}`,
  ])("drops %j", (value) => {
    expect(safeReturnTo(value)).toBeUndefined();
  });

  it("drops a missing value", () => {
    expect(safeReturnTo(null)).toBeUndefined();
    expect(safeReturnTo(undefined)).toBeUndefined();
  });
});
