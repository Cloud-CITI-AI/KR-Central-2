import { describe, expect, it } from "vitest";
import { validateReturnTo } from "./return-to.js";

describe("validateReturnTo", () => {
  it("defaults to the dashboard when absent or empty", () => {
    expect(validateReturnTo(undefined)).toBe("/");
    expect(validateReturnTo("")).toBe("/");
  });

  it.each(["/", "/jobs/0f8fad5b-d9cb-469f-a165-70867728950e", "/admin/users?q=a%20b#top", "/a//b", "/https://x.test"])(
    "keeps the same-origin path %s",
    (path) => {
      expect(validateReturnTo(path)).toBe(path);
    },
  );

  it.each([
    ["scheme-relative", "//evil.test/x"],
    ["absolute URL", "https://evil.test/"],
    ["javascript URL", "javascript:alert(1)"],
    ["relative path", "jobs/1"],
    ["backslash host (browsers read it as //)", "/\\evil.test"],
    ["tab inside //", "/\t/evil.test"],
    ["newline", "/jobs\n/x"],
    ["unicode space", "/ /evil.test"],
    ["DEL character", "/a\u007fb"],
    ["too long", `/${"a".repeat(512)}`],
  ])("rejects %s", (_name, value) => {
    expect(validateReturnTo(value)).toBeNull();
  });

  it("accepts a path of exactly the maximum length", () => {
    const max = `/${"a".repeat(511)}`;
    expect(validateReturnTo(max)).toBe(max);
  });
});
