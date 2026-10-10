import { describe, expect, it } from "vitest";
import { buildBlankPdf, buildPdf } from "../../test/fixtures/builders.js";
import { fromStampAnnotation } from "../rules/conformed.js";
import { pdfFirstPage, pdfStampAnnotations } from "./annotations.js";

const STAMP = "DATE 16-Mar-2026 FILE 123-26";

describe("pdfStampAnnotations", () => {
  it("returns the text of a FreeText stamp on page 1, which fromStampAnnotation reads", async () => {
    const annotations = await pdfStampAnnotations(await buildPdf({ pages: [["Conformance"]], stamp: STAMP }));
    expect(annotations).toEqual([STAMP]);
    expect(fromStampAnnotation(annotations)).toEqual({ date: "2026-03-16", method: "stamp_annotation" });
  });

  it("returns nothing for a PDF without annotations", async () => {
    expect(await pdfStampAnnotations(await buildPdf({ pages: [["Conformance"]] }))).toEqual([]);
  });

  it("only looks at page 1", async () => {
    const bytes = await buildPdf({ pages: [["one"], ["two"]], stamp: STAMP });
    expect(await pdfStampAnnotations(bytes)).toEqual([STAMP]);
  });

  it("applies the page cap and rejects non-PDF input", async () => {
    await expect(pdfStampAnnotations(await buildBlankPdf(2), { maxPages: 1 })).rejects.toMatchObject({
      code: "too_many_pages",
    });
    await expect(pdfStampAnnotations(new Uint8Array([1, 2, 3]))).rejects.toMatchObject({ code: "not_a_pdf" });
  });
});

describe("first-page readers on a long PDF (PRODUCT_SPEC §10.1 reads page 1 only; the page cap protects full-text reads)", () => {
  const longWithStamp = () =>
    buildPdf({
      pages: [["Conformed", "16 March 2026"], ...Array.from({ length: 79 }, (_, i) => [`Page ${i + 2}`])],
      stamp: STAMP,
    });

  it("reads page 1 of an 80-page PDF by default", async () => {
    const bytes = await longWithStamp();
    expect(await pdfFirstPage(bytes)).toEqual({ lines: ["Conformed", "16 March 2026"], annotations: [STAMP] });
    expect(await pdfStampAnnotations(bytes)).toEqual([STAMP]);
  });
});

describe("pdfFirstPage", () => {
  it("returns page-1 lines and annotations from one open", async () => {
    const bytes = await buildPdf({ pages: [["Conformed", "16 March 2026"], ["Second page"]], stamp: STAMP });
    expect(await pdfFirstPage(bytes)).toEqual({ lines: ["Conformed", "16 March 2026"], annotations: [STAMP] });
  });
});
