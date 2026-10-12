import { describe, expect, it } from "vitest";
import { ConflictError } from "../../../platform/errors.js";
import {
  RangeNotSatisfiableError,
  SANDBOX_CSP,
  SCAN_MESSAGES,
  assertServable,
  contentDispositionFor,
  contentHeadersFor,
  parseRange,
} from "./content-headers.js";

const file = (kind: "pdf" | "image" | "video" | "text" | "dwg" | "email", contentType: string, name = "a.bin") => ({
  kind,
  content_type: contentType,
  original_name: name,
});

describe("assertServable", () => {
  it("lets clean and skipped files through", () => {
    expect(() => {
      assertServable("clean");
      assertServable("skipped");
    }).not.toThrow();
  });

  it.each([
    ["pending", "urn:kr:problem:file-not-ready", "This file is still being checked for viruses."],
    ["infected", "urn:kr:problem:file-rejected", "Blocked – failed the virus scan"],
    ["error", "urn:kr:problem:file-rejected", "Couldn't be checked for viruses – remove it and upload it again"],
  ] as const)("%s is a 409 with the spec message", (status, type, detail) => {
    try {
      assertServable(status);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ConflictError);
      expect(e).toMatchObject({ status: 409, type, detail });
      expect(SCAN_MESSAGES[status]).toBe(detail);
    }
  });
});

describe("contentHeadersFor", () => {
  it("serves a PDF inline without the sandbox, others with it", () => {
    expect(contentHeadersFor(file("pdf", "application/pdf", "plan.pdf"), "inline")).toEqual({
      contentType: "application/pdf",
      contentDisposition: `inline; filename="plan.pdf"; filename*=UTF-8''plan.pdf`,
      contentSecurityPolicy: null,
    });
    expect(contentHeadersFor(file("image", "image/png"), "inline")).toMatchObject({
      contentType: "image/png",
      contentSecurityPolicy: SANDBOX_CSP,
    });
    expect(SANDBOX_CSP).toBe(
      "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox",
    );
  });

  it("serves every text kind as text/plain; charset=utf-8", () => {
    for (const type of ["text/plain", "text/csv", "text/markdown"]) {
      expect(contentHeadersFor(file("text", type), "inline").contentType).toBe("text/plain; charset=utf-8");
    }
  });

  it("is an attachment for DWG and email, and whenever an attachment is asked for", () => {
    expect(contentHeadersFor(file("dwg", "image/vnd.dwg", "p.dwg"), "inline").contentDisposition).toMatch(
      /^attachment;/,
    );
    expect(contentHeadersFor(file("email", "message/rfc822"), "inline").contentDisposition).toMatch(/^attachment;/);
    expect(contentHeadersFor(file("pdf", "application/pdf"), "attachment").contentDisposition).toMatch(/^attachment;/);
    expect(contentHeadersFor(file("video", "video/mp4"), "inline").contentDisposition).toMatch(/^inline;/);
  });
});

describe("contentDispositionFor", () => {
  it("keeps the real name in filename* and an ASCII, quote-free fallback in filename", () => {
    expect(contentDispositionFor("attachment", `Plan "A" – 50% (v2)'s.pdf`)).toBe(
      `attachment; filename="Plan _A_ _ 50_ (v2)'s.pdf"; filename*=UTF-8''Plan%20%22A%22%20%E2%80%93%2050%25%20%28v2%29%27s.pdf`,
    );
  });
});

describe("parseRange", () => {
  it.each([
    ["bytes=0-99", 1000, { start: 0, end: 99 }],
    ["bytes=900-", 1000, { start: 900, end: 999 }],
    ["bytes=900-5000", 1000, { start: 900, end: 999 }],
    ["bytes=-100", 1000, { start: 900, end: 999 }],
    ["bytes=-5000", 1000, { start: 0, end: 999 }],
    ["bytes=0-0", 1000, { start: 0, end: 0 }],
    [" bytes=10-20 ", 1000, { start: 10, end: 20 }],
  ] as const)("%s of %i bytes", (header, size, expected) => {
    expect(parseRange(header, size)).toEqual(expected);
  });

  it.each([undefined, "", "bytes=", "bytes=-", "items=0-5", "bytes=0-5,10-20", "bytes=a-b", "bytes=5-3", "0-5"])(
    "ignores %j and serves the whole file",
    (header) => {
      expect(parseRange(header, 1000)).toBeNull();
    },
  );

  it.each(["bytes=1000-", "bytes=2000-3000", "bytes=-0"])("%s is a 416 that reports the size", (header) => {
    try {
      parseRange(header, 1000);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(RangeNotSatisfiableError);
      expect(e).toMatchObject({ status: 416, headers: { "content-range": "bytes */1000" } });
    }
  });

  it("is a 416 for any range of an empty file", () => {
    expect(() => parseRange("bytes=-5", 0)).toThrow(RangeNotSatisfiableError);
    expect(() => parseRange("bytes=0-", 0)).toThrow(RangeNotSatisfiableError);
  });
});

describe("contentHeadersFor with a dangerous extension on a text file stored before the allow-list", () => {
  it("serves it under a .txt name so it can never run from a download", () => {
    const h = contentHeadersFor(file("text", "text/plain", "evil.vbe"), "attachment");
    expect(h.contentDisposition).toBe(`attachment; filename="evil.vbe.txt"; filename*=UTF-8''evil.vbe.txt`);
  });

  it.each([
    ["pdf", "application/pdf", "report.exe", "report.exe.pdf"],
    ["pdf", "application/pdf", "invoice.pdf.lnk", "invoice.pdf.lnk.pdf"],
    ["pdf", "application/pdf", "noext", "noext.pdf"],
    ["image", "image/png", "photo.exe", "photo.exe.png"],
    ["image", "image/jpeg", "photo.hta", "photo.hta.jpg"],
    ["video", "video/mp4", "clip.scr", "clip.scr.mp4"],
    ["dwg", "image/vnd.dwg", "site.bat", "site.bat.dwg"],
  ] as const)("serves a sniffed %s stored as %j under %j", (kind, contentType, name, served) => {
    for (const requested of ["inline", "attachment"] as const)
      expect(contentHeadersFor(file(kind, contentType, name), requested).contentDisposition).toBe(
        `${requested === "inline" && kind !== "dwg" ? "inline" : "attachment"}; filename="${served}"; filename*=UTF-8''${served}`,
      );
  });

  it("leaves the name of other kinds and of proper text files alone", () => {
    expect(contentHeadersFor(file("pdf", "application/pdf", "Plan.pdf"), "inline").contentDisposition).toContain(
      'filename="Plan.pdf"',
    );
    expect(contentHeadersFor(file("text", "text/plain", "notes.txt"), "inline").contentDisposition).toContain(
      'filename="notes.txt"',
    );
  });
});
