import { AuthLoginQuery } from "@kr/contracts";
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

  it("agrees with the contract's returnTo rule (written out in return-to.ts so the client does not load Zod)", () => {
    const samples = [
      "/",
      "/a",
      "/a b",
      "/a\tb",
      "//x",
      "/\\x",
      "/a/b?c=d#e",
      `/${"a".repeat(511)}`,
      `/${"a".repeat(512)}`,
      "/é",
      "/%2F",
      "a",
      "",
    ];
    for (const sample of samples) {
      const parsed = AuthLoginQuery.shape.returnTo.safeParse(sample);
      expect(safeReturnTo(sample), JSON.stringify(sample)).toBe(parsed.success ? parsed.data : undefined);
    }
  });
});
