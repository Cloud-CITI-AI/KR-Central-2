import { describe, expect, it } from "vitest";
import { decodeMultipartFileName, sanitiseFileName, servedFileName } from "./index.js";

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

describe("servedFileName", () => {
  it.each([
    ["evil.vbe", "text", "evil.vbe.txt"],
    ["shortcut.url", "text", "shortcut.url.txt"],
    ["Invoice.pdf.exe", "text", "Invoice.pdf.exe.txt"],
    ["notes", "text", "notes.txt"],
    ["a.TXT", "text", "a.TXT"],
    ["d.csv", "text", "d.csv"],
    ["r.md", "text", "r.md"],
    ["run.psm1", "email", "run.psm1.txt"],
    ["Query.txt", "email", "Query.txt"],
    ["mail.eml", "email", "mail.eml"],
    ["mail.MSG", "email", "mail.MSG"],
    ["Plan.pdf", "pdf", "Plan.pdf"],
    ["Plan.PDF", "pdf", "Plan.PDF"],
    ["site.dwg", "dwg", "site.dwg"],
    ["photo.JPG", "image", "photo.JPG"],
    ["photo.jpeg", "image", "photo.jpeg"],
    ["photo.png", "image", "photo.png"],
    ["photo.gif", "image", "photo.gif"],
    ["photo.webp", "image", "photo.webp"],
    ["photo.heic", "image", "photo.heic"],
    ["clip.mp4", "video", "clip.mp4"],
    ["clip.MOV", "video", "clip.MOV"],
    ["clip.webm", "video", "clip.webm"],
  ] as const)("%j (%s) is served as %j", (name, kind, expected) => {
    expect(servedFileName(name, kind)).toBe(expected);
  });

  // QA r2: a sniffed binary keeps its stored name but is served under an extension canonical for what it is, so a PDF
  // uploaded as report.exe is never downloaded or zipped as something the recipient's machine runs.
  it.each([
    ["report.exe", "pdf", undefined, "report.exe.pdf"],
    ["invoice.pdf.lnk", "pdf", "application/pdf", "invoice.pdf.lnk.pdf"],
    ["noext", "pdf", undefined, "noext.pdf"],
    ["evil.vbe", "pdf", undefined, "evil.vbe.pdf"],
    ["plan.bat", "dwg", "image/vnd.dwg", "plan.bat.dwg"],
    ["photo.exe", "image", "image/jpeg", "photo.exe.jpg"],
    ["photo.scr", "image", "image/png", "photo.scr.png"],
    ["photo.hta", "image", "image/gif", "photo.hta.gif"],
    ["photo.cmd", "image", "image/webp", "photo.cmd.webp"],
    ["photo.pdf", "image", "image/png", "photo.pdf.png"],
    ["photo.js", "image", undefined, "photo.js.png"],
    ["clip.exe", "video", "video/mp4", "clip.exe.mp4"],
    ["clip.msi", "video", "video/webm", "clip.msi.webm"],
    ["clip", "video", undefined, "clip.mp4"],
    ["Plan.png", "pdf", "application/pdf", "Plan.png.pdf"],
  ] as const)("%j (%s %s) is served as %j", (name, kind, contentType, expected) => {
    expect(servedFileName(name, kind, contentType)).toBe(expected);
  });

  it("does not take a dot inside a directory-like name for an extension", () => {
    expect(servedFileName("v1.2/final", "pdf")).toBe("v1.2/final.pdf");
  });
});

describe("decodeMultipartFileName", () => {
  it.each([
    ["quo%22te;name=evil.pdf", 'quo"te;name=evil.pdf'],
    ["name%0D%0AX-Injected: 1.pdf", "name\r\nX-Injected: 1.pdf"],
    ["a%0Ab%0d.pdf", "a\nb\r.pdf"],
    ["%22quoted%22.pdf", '"quoted".pdf'],
    ["100%.pdf", "100%.pdf"],
    ["50%25 off.pdf", "50%25 off.pdf"],
    ["%2e%2e%2fx.pdf", "%2e%2e%2fx.pdf"],
    ["plain.pdf", "plain.pdf"],
  ])("%j -> %j", (input, expected) => {
    expect(decodeMultipartFileName(input)).toBe(expected);
  });

  it("then sanitising keeps quotes readable and drops line breaks", () => {
    expect(sanitiseFileName(decodeMultipartFileName("quo%22te;name=evil.pdf"))).toBe('quo"te;name=evil.pdf');
    expect(sanitiseFileName(decodeMultipartFileName("name%0D%0AX-Injected: 1.pdf"))).toBe("nameX-Injected: 1.pdf");
  });
});
