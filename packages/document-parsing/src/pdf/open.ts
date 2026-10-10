/**
 * The one place that opens a PDF with pdf.js (legacy build, in-process "fake worker": the worker service isolates calls
 * and enforces the 60 s timeout). Untrusted input: no eval, no system fonts, no page text beyond the page cap.
 */
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { getDocument, InvalidPDFException, PasswordException } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { PDFDocumentProxy } from "pdfjs-dist/legacy/build/pdf.mjs";
import { DocumentParseError } from "../errors.js";
import type { PdfLimits } from "../types.js";

export const DEFAULT_PDF_LIMITS: PdfLimits = { maxPages: 60 };

/**
 * The limits of the readers that only ever look at page 1 (stamp annotations, first-page text, the stamp render): the page
 * cap protects full-text reads (Decision Letters, PRODUCT_SPEC §10.2/§15), so those readers open any length of document.
 * Their time, heap and image-size guards still apply; a caller may still pass `maxPages` to cap them.
 */
export const FIRST_PAGE_LIMITS: PdfLimits = { maxPages: Number.POSITIVE_INFINITY };

/** Bundled Helvetica/Times/... substitutes so text renders the same on every machine. */
const STANDARD_FONTS = `${join(dirname(createRequire(import.meta.url).resolve("pdfjs-dist/package.json")), "standard_fonts")}/`;

/**
 * Opens `data`, rejects encrypted PDFs and PDFs with more than `maxPages` pages (a "too many pages" error, not a silent
 * truncation: §15 "operation fails with a clear message"), runs `read`, and always releases the document.
 */
export async function withPdf<T>(
  data: Uint8Array,
  limits: Partial<PdfLimits>,
  read: (pdf: PDFDocumentProxy) => Promise<T>,
): Promise<T> {
  const { maxPages } = { ...DEFAULT_PDF_LIMITS, ...limits };
  // pdfjs-dist 6.4 no longer has an `isEvalSupported` option (it never compiles PDF functions with eval); it is still
  // passed (as a variable, so it is not an excess-property error), so the "no eval" contract stays visible and holds if a later version brings the option back.
  const params = {
    data: new Uint8Array(data), // pdf.js may take ownership of the buffer it is given
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
    enableXfa: false,
    standardFontDataUrl: STANDARD_FONTS,
    maxImageSize: 16_777_216,
    verbosity: 0,
  };
  const task = getDocument(params);
  try {
    const pdf = await task.promise;
    if (pdf.numPages > maxPages) {
      throw new DocumentParseError("too_many_pages", `The PDF has ${pdf.numPages} pages; the limit is ${maxPages}.`);
    }
    return await read(pdf);
  } catch (error) {
    throw toParseError(error);
  } finally {
    await task.destroy();
  }
}

function toParseError(error: unknown): DocumentParseError {
  if (error instanceof DocumentParseError) return error;
  if (error instanceof PasswordException) {
    return new DocumentParseError("encrypted_pdf", "The PDF is password protected.", { cause: error });
  }
  if (error instanceof InvalidPDFException) {
    return new DocumentParseError("not_a_pdf", "The file is not a valid PDF.", { cause: error });
  }
  return new DocumentParseError("unreadable_pdf", "The PDF could not be read.", { cause: error });
}
