import { describe, expect, it } from "vitest";
import { fileExtension, matchesAccept, validateFiles } from "./files";

const file = (name: string, type = "", size = 10) => new File([new Uint8Array(size)], name, { type });

describe("matchesAccept", () => {
  it("matches extensions case-insensitively, mime wildcards and exact mime types", () => {
    expect(matchesAccept(file("Plan.PDF"), [".pdf"])).toBe(true);
    expect(matchesAccept(file("a.jpg", "image/jpeg"), [".pdf", "image/*"])).toBe(true);
    expect(matchesAccept(file("x", "application/pdf"), ["application/pdf"])).toBe(true);
    expect(matchesAccept(file("a.dwg"), [".pdf", "image/*"])).toBe(false);
    expect(matchesAccept(file("a.png", "image/png"), [".pdf"])).toBe(false);
  });
});

describe("fileExtension", () => {
  it("is the upper-case extension, or FILE", () => {
    expect(fileExtension("Decision Letter.pdf")).toBe("PDF");
    expect(fileExtension("site.plan.dwg")).toBe("DWG");
    expect(fileExtension("README")).toBe("FILE");
    expect(fileExtension(".hidden")).toBe("FILE");
    expect(fileExtension("trailing.")).toBe("FILE");
  });
});

describe("validateFiles", () => {
  const rules = { accept: [".pdf", "image/*"], acceptDescription: "PDF or photo", maxBytes: 50 * 1024 * 1024 };

  it("accepts files that fit", () => {
    const ok = file("a.pdf");
    expect(validateFiles([ok], rules)).toEqual({ accepted: [ok], rejected: [] });
  });

  it("rejects an oversized file with the §5.5 text, and a wrong type with the box's description", () => {
    const big = file("huge.pdf", "application/pdf", 60 * 1024 * 1024);
    const wrong = file("drawing.dwg");
    const { accepted, rejected } = validateFiles([big, wrong], rules);
    expect(accepted).toEqual([]);
    expect(rejected.map((r) => r.message)).toEqual([
      "huge.pdf is larger than 50 MB",
      "drawing.dwg isn't a supported type for this box (use PDF or photo)",
    ]);
  });

  it("omits the hint when there is no description and accepts anything without rules", () => {
    expect(validateFiles([file("a.dwg")], { accept: [".pdf"] }).rejected[0]?.message).toBe(
      "a.dwg isn't a supported type for this box",
    );
    expect(validateFiles([file("a.dwg")], {}).accepted).toHaveLength(1);
  });

  it("takes only the first file for a single-file box and says so for the rest", () => {
    const [a, b] = [file("a.pdf"), file("b.pdf")];
    const { accepted, rejected } = validateFiles([a, b], { multiple: false });
    expect(accepted).toEqual([a]);
    expect(rejected[0]?.message).toBe("b.pdf wasn't added – this box takes one file at a time");
  });
});
