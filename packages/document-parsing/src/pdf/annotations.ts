/** Text of page-1 annotations: a digital stamp is usually a Stamp or FreeText annotation (PRODUCT_SPEC §10.1 step 2). */
import type { PDFPageProxy } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { PdfFirstPage, PdfLimits } from "../types.js";
import { withPdf } from "./open.js";
import { pageTextLines } from "./text.js";

/** The annotation fields pdf.js fills with text (its `getAnnotations` is typed `any[]`). */
interface RawAnnotation {
  readonly contentsObj?: { readonly str?: string };
  readonly contents?: string;
  readonly textContent?: readonly string[];
  readonly fieldValue?: unknown;
}

/** One string per annotation that carries text (contents, rich text, field value); annotations without text are dropped. */
export async function pageAnnotationTexts(page: PDFPageProxy): Promise<string[]> {
  const annotations = (await page.getAnnotations()) as RawAnnotation[];
  const texts: string[] = [];
  for (const a of annotations) {
    const parts = [a.contentsObj?.str, a.contents, a.textContent?.join(" "), a.fieldValue].filter(
      (p): p is string => typeof p === "string" && p.trim() !== "",
    );
    const text = [...new Set(parts)].join(" ").replace(/\s+/g, " ").trim();
    if (text) texts.push(text);
  }
  return texts;
}

/** Annotation texts on page 1 (empty for a PDF without pages). Feed them to `fromStampAnnotation`. */
export function pdfStampAnnotations(data: Uint8Array, limits: Partial<PdfLimits> = {}): Promise<string[]> {
  return withPdf(data, limits, async (pdf) => (pdf.numPages > 0 ? pageAnnotationTexts(await pdf.getPage(1)) : []));
}

/** Page 1 text lines and annotation texts from one open of the file (what the conformed-date readers need). */
export function pdfFirstPage(data: Uint8Array, limits: Partial<PdfLimits> = {}): Promise<PdfFirstPage> {
  return withPdf(data, limits, async (pdf) => {
    if (pdf.numPages === 0) return { lines: [], annotations: [] };
    const page = await pdf.getPage(1);
    return { lines: await pageTextLines(page), annotations: await pageAnnotationTexts(page) };
  });
}
