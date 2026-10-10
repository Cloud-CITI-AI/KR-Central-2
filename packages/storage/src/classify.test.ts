import { describe, expect, it } from "vitest";
import { FILE_KINDS } from "@kr/workflow";
import { SNIFF_BYTES, classifyContent, isAcceptedForSlot } from "./index.js";

// Synthetic headers only (no real documents).
const bytes = (...parts: (string | readonly number[])[]): Uint8Array =>
  Buffer.concat(parts.map((p) => (typeof p === "string" ? Buffer.from(p, "latin1") : Buffer.from(p))));
const zeros = (n: number): number[] => Array.from({ length: n }, () => 0);

const PNG = bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13], "IHDR", zeros(21), "IEND", zeros(4));
const JPEG = bytes([0xff, 0xd8, 0xff, 0xe0, 0, 0x10], "JFIF\0", zeros(60));
const WEBP = bytes("RIFF", [0x24, 0, 0, 0], "WEBPVP8 ", zeros(60));
const MP4 = bytes([0, 0, 0, 0x18], "ftypisom", [0, 0, 2, 0], "isomiso2", zeros(40));
const WEBM = bytes([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x82, 0x84], "webm", zeros(60));
const DWG = bytes("AC1032", [0, 0, 0, 0, 0, 1], zeros(60));
const CFB = bytes([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1], zeros(100));
const EML = "From: Alex <alex@example.test>\r\nTo: sam@example.test\r\nSubject: Plan\r\n  (folded)\r\n\r\nBody text";

describe("classifyContent accepts", () => {
  it.each([
    ["PDF", bytes("%PDF-1.7\n%\xe2\xe3\xcf\xd3\n"), "a.pdf", "pdf", "application/pdf", "pdf"],
    ["PNG", PNG, "a.png", "image", "image/png", "png"],
    ["JPEG", JPEG, "a.jpeg", "image", "image/jpeg", "jpg"],
    ["GIF", bytes("GIF89a", zeros(60)), "a.gif", "image", "image/gif", "gif"],
    ["WebP", WEBP, "a.webp", "image", "image/webp", "webp"],
    ["MP4", MP4, "a.mp4", "video", "video/mp4", "mp4"],
    ["WebM", WEBM, "a.webm", "video", "video/webm", "webm"],
    ["DWG", DWG, "plan.dwg", "dwg", "image/vnd.dwg", "dwg"],
    ["Outlook message", CFB, "mail.MSG", "email", "application/vnd.ms-outlook", "msg"],
    ["RFC 822 email", Buffer.from(EML), "mail.eml", "email", "message/rfc822", "eml"],
    ["text", Buffer.from("héllo ✓\n"), "n.txt", "text", "text/plain", "txt"],
    ["CSV", Buffer.from("a,b\n1,2\n"), "d.CSV", "text", "text/csv", "csv"],
    ["Markdown", Buffer.from("# Title\n"), "r.md", "text", "text/markdown", "md"],
    ["UTF-8 BOM text", bytes([0xef, 0xbb, 0xbf], "notes"), "n.txt", "text", "text/plain", "txt"],
  ] as const)("%s", async (_label, head, name, kind, contentType, extension) => {
    expect(await classifyContent(head, name)).toEqual({ kind, contentType, extension });
  });

  it("ignores the name for binary kinds and the declared extension", async () => {
    expect(await classifyContent(PNG, "evil.pdf")).toMatchObject({ kind: "image" });
  });

  it("tolerates a multi-byte character cut at the end of a full head", async () => {
    const head = Buffer.from("a".repeat(SNIFF_BYTES - 1) + "€").subarray(0, SNIFF_BYTES);
    expect(await classifyContent(head, "big.txt")).toMatchObject({ kind: "text" });
  });

  it("treats text that merely starts with a DWG-like prefix as text", async () => {
    expect(await classifyContent(Buffer.from("AC1015 quote"), "q.txt")).toMatchObject({ kind: "text" });
  });

  it("keeps email headers as text unless the name is .eml", async () => {
    expect(await classifyContent(Buffer.from(EML), "mail.txt")).toMatchObject({ kind: "text" });
  });

  it("refuses an .eml that is not an RFC 822 message (text is TXT, CSV or MD only)", async () => {
    for (const text of ["Hi: there\nNote: x\n", "From: a\nbroken line\nTo: b", " From: a"]) {
      expect(await classifyContent(Buffer.from(text), "a.eml")).toEqual({
        rejected: "Text files must be .txt, .csv or .md",
      });
    }
  });
});

describe("classifyContent treats UTF-8 text without NUL as text even when it starts with a known magic", () => {
  it.each([
    ["BM", "BMW service notes", "a.txt", "text/plain", "txt"],
    ["MZ", "MZ123 order", "a.txt", "text/plain", "txt"],
    ["ID3", "ID3 tag notes", "a.md", "text/markdown", "md"],
    ["BM in a CSV header", "BMI,height\n22,180\n", "a.csv", "text/csv", "csv"],
    ["MZ in a CSV header", "MZ code,name\n1,x\n", "a.csv", "text/csv", "csv"],
    ["a calendar line", "BEGIN:VCALENDAR\nVERSION:2.0\n", "a.txt", "text/plain", "txt"],
    ["RTF-like text", "{\\rtf1 hello}", "a.txt", "text/plain", "txt"],
    ["PostScript-like text", "%!PS-Adobe-3.0\n", "a.txt", "text/plain", "txt"],
  ] as const)("%s", async (_label, text, name, contentType, extension) => {
    expect(await classifyContent(Buffer.from(text), name)).toEqual({ kind: "text", contentType, extension });
  });

  it("still rejects scripts and HTML that start with such a magic", async () => {
    expect(await classifyContent(Buffer.from("MZ123"), "run.js")).toEqual({ rejected: "Scripts are not accepted" });
    expect(await classifyContent(Buffer.from("BM"), "run.sh")).toEqual({ rejected: "Scripts are not accepted" });
  });

  it("still rejects a magic followed by invalid UTF-8", async () => {
    expect(await classifyContent(bytes("BM", [0xff, 0xfe, 0xfd]), "a.txt")).toHaveProperty("rejected");
  });
});

describe("classifyContent accepts text only under a text name (TXT, CSV, MD)", () => {
  it.each([
    "evil.vbe",
    "evil.vbs.vbe",
    "script.jse",
    "a.wsh",
    "a.wsf",
    "a.wsc",
    "shortcut.url",
    "update.reg",
    "x.scf",
    "setup.inf",
    "run.psm1",
    "run.psd1",
    "do.command",
    "app.desktop",
    "x.appref-ms",
    "Invoice.pdf.exe",
    "x.lnk",
    "x.jar",
    "x.docm",
    "notes",
    "notes.",
    "a.log",
    ".txt.bak",
  ])("refuses plain text named %j", async (name) => {
    const body = Buffer.from("[InternetShortcut]\r\nURL=file://attacker.example/share/x\r\n");
    expect(await classifyContent(body, name)).toEqual({ rejected: "Text files must be .txt, .csv or .md" });
  });

  it.each(["a.txt", "A.TXT", "evil.vbe.txt", "d.csv", "r.md", "Plan notes.v2.md"])("accepts %j", async (name) => {
    expect(await classifyContent(Buffer.from("hello\n"), name)).toMatchObject({ kind: "text" });
  });

  it("still names scripts as scripts", async () => {
    expect(await classifyContent(Buffer.from("x"), "a.ps1")).toEqual({ rejected: "Scripts are not accepted" });
  });
});

describe("classifyContent rejects", () => {
  it.each([
    ["an HTML file named .pdf", Buffer.from("<!DOCTYPE html><html><body>x</body></html>"), "a.pdf", /HTML/],
    ["HTML with leading blanks", Buffer.from(" \n <script>alert(1)</script>"), "a.txt", /HTML/],
    ["SVG", Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>'), "a.png", /SVG/],
    ["SVG with an XML prolog", Buffer.from('<?xml version="1.0"?>\n<svg onload="x()"/>'), "a.svg", /HTML|XML|SVG/],
    ["JavaScript by name", Buffer.from("alert(1)\n"), "a.js", /Scripts/],
    ["a shebang script", Buffer.from("#!/bin/sh\nrm -rf /\n"), "a.txt", /Scripts/],
    ["a Windows executable", bytes("MZ", zeros(100)), "a.pdf", /Executable.*exe/],
    ["an ELF executable", bytes([0x7f], "ELF", [2, 1, 1, 0], zeros(100)), "a.pdf", /Executable.*elf/],
    ["a zip", bytes("PK", [3, 4, 0x14, 0, 0, 0, 8, 0], zeros(100)), "a.zip", /Archive.*zip/],
    ["a gzip", bytes([0x1f, 0x8b, 8, 0], zeros(100)), "a.pdf", /Archive.*gz/],
    ["a legacy Office file", CFB, "a.doc", /Outlook/],
    ["another recognised type", bytes("BM", zeros(100)), "a.bmp", /not accepted \(bmp\)/],
    ["binary data", bytes([0x80, 0x81, 0x00, 0x01], zeros(10)), "a.bin", /binary/],
    ["invalid UTF-8", bytes([0xc3, 0x28], "text"), "a.txt", /UTF-8/],
    ["text containing NUL", bytes("text\0more"), "a.txt", /binary/],
    ["an empty file", new Uint8Array(0), "a.pdf", /empty/],
  ] as const)("%s", async (_label, head, name, reason) => {
    const result = await classifyContent(head, name);
    expect(result).toHaveProperty("rejected");
    expect((result as { rejected: string }).rejected).toMatch(reason);
  });
});

describe("isAcceptedForSlot", () => {
  const pdf = { kind: "pdf", contentType: "application/pdf", extension: "pdf" } as const;

  it("checks the kind against the slot's accepted kinds", () => {
    expect(isAcceptedForSlot(pdf, ["pdf", "image"])).toBe(true);
    expect(isAcceptedForSlot(pdf, ["image"])).toBe(false);
    expect(isAcceptedForSlot(pdf, [])).toBe(false);
  });

  it("never accepts a rejection", () => {
    expect(isAcceptedForSlot({ rejected: "no" }, FILE_KINDS)).toBe(false);
  });
});
