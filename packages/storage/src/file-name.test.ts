import { describe, expect, it } from "vitest";
import { sanitiseFileName } from "./index.js";

describe("sanitiseFileName", () => {
  it.each([
    ["Plan 1 – final.pdf", "Plan 1 – final.pdf"],
    ["../../etc/passwd", "passwd"],
    ["C:\\Users\\x\\scan.pdf", "scan.pdf"],
    ["a/b\\c/photo.jpg", "photo.jpg"],
    ["re\u0000po\u001Frt\u007F.pdf", "report.pdf"],
    ["inv\u202Eoice\u200B.pdf", "invoice.pdf"],
    ["line\nbreak\u2028.txt", "linebreak.txt"],
    ["  spaced name.pdf  ", "spaced name.pdf"],
    ["name.pdf. . ", "name.pdf"],
    ["e\u0301.pdf", "\u00e9.pdf"],
    ["bad\uD800.txt", "bad\uFFFD.txt"],
    ["/", "file"],
    ["..", "file"],
    ["\u0000\u0001", "file"],
    ["", "file"],
  ])("%j -> %j", (input, expected) => {
    expect(sanitiseFileName(input)).toBe(expected);
  });

  it("keeps a name of exactly 255 characters", () => {
    const name = `${"a".repeat(251)}.pdf`;
    expect(sanitiseFileName(name)).toBe(name);
  });

  it("truncates to 255 characters and keeps the extension", () => {
    const result = sanitiseFileName(`${"a".repeat(400)}.pdf`);
    expect(result).toHaveLength(255);
    expect(result.endsWith("aaa.pdf")).toBe(true);
  });

  it("truncates a long name without an extension", () => {
    expect(sanitiseFileName("b".repeat(300))).toBe("b".repeat(255));
  });

  it("does not treat an overlong suffix as an extension", () => {
    expect(sanitiseFileName(`x.${"y".repeat(300)}`)).toBe(`x.${"y".repeat(253)}`);
  });

  it("never splits a surrogate pair and stays within 255 units", () => {
    const result = sanitiseFileName(`${"😀".repeat(200)}.png`);
    expect(result.length).toBeLessThanOrEqual(255);
    expect(result.endsWith("😀.png")).toBe(true);
    expect(result).not.toMatch(/\uFFFD/);
  });

  it("drops trailing dots and spaces exposed by truncation", () => {
    expect(sanitiseFileName(`${"a".repeat(250)}. . . . . .pdf`)).toBe(`${"a".repeat(250)}.pdf`);
  });
});
