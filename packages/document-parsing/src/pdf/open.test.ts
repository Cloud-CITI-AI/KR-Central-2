import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it, vi } from "vitest";
import { buildBlankPdf, buildEncryptedPdf, buildPdf } from "../../test/fixtures/builders.js";
import { DocumentParseError } from "../errors.js";
import { DEFAULT_PDF_LIMITS, withPdf } from "./open.js";

vi.mock("pdfjs-dist/legacy/build/pdf.mjs", async (importOriginal) => {
  const original = await importOriginal<typeof pdfjs>();
  return { ...original, getDocument: vi.fn(original.getDocument) };
});

const pageCount = (pdf: { numPages: number }): Promise<number> => Promise.resolve(pdf.numPages);

async function codeOf(promise: Promise<unknown>): Promise<string> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(DocumentParseError);
  return (error as DocumentParseError).code;
}

describe("withPdf", () => {
  it("opens PDFs without eval, system fonts or XFA", async () => {
    const bytes = await buildPdf({ pages: [["hello"]] });
    await withPdf(bytes, {}, pageCount);
    expect(pdfjs.getDocument).toHaveBeenLastCalledWith(
      expect.objectContaining({ isEvalSupported: false, useSystemFonts: false, enableXfa: false, verbosity: 0 }),
    );
  });

  it("does not hand the caller's buffer to pdf.js (it may be detached)", async () => {
    const bytes = await buildPdf({ pages: [["hello"]] });
    await withPdf(bytes, {}, pageCount);
    expect(bytes.byteLength).toBeGreaterThan(0);
  });

  it("allows exactly maxPages pages and rejects one more (default 60)", async () => {
    expect(DEFAULT_PDF_LIMITS.maxPages).toBe(60);
    expect(await withPdf(await buildBlankPdf(60), {}, pageCount)).toBe(60);
    expect(await codeOf(withPdf(await buildBlankPdf(61), {}, pageCount))).toBe("too_many_pages");
    expect(await withPdf(await buildBlankPdf(3), { maxPages: 3 }, pageCount)).toBe(3);
    expect(await codeOf(withPdf(await buildBlankPdf(4), { maxPages: 3 }, pageCount))).toBe("too_many_pages");
  });

  it("rejects a password-protected PDF as encrypted_pdf", async () => {
    expect(await codeOf(withPdf(await buildEncryptedPdf(), {}, pageCount))).toBe("encrypted_pdf");
  });

  it.each([
    ["text", new TextEncoder().encode("this is not a pdf")],
    ["empty", new Uint8Array()],
  ])("rejects %s input as not_a_pdf", async (_name, bytes) => {
    expect(await codeOf(withPdf(bytes, {}, pageCount))).toBe("not_a_pdf");
  });

  it("maps a failure while reading to unreadable_pdf and keeps the cause", async () => {
    const bytes = await buildBlankPdf(1);
    const error = await withPdf(bytes, {}, () => Promise.reject(new Error("boom"))).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: "unreadable_pdf", cause: expect.objectContaining({ message: "boom" }) });
  });
});
