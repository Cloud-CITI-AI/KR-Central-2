/** PDF text as lines (port of the prototype's pdfText): items on one baseline form a line; a blank line ends each page. */
import type { PDFPageProxy } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { PdfLimits } from "../types.js";
import { withPdf } from "./open.js";

/** Lines of one page (whitespace collapsed, empty lines kept as ""). */
export async function pageTextLines(page: PDFPageProxy): Promise<string[]> {
  const { items } = await page.getTextContent();
  const lines: string[] = [];
  let current: string | null = null;
  let lastY: number | null = null;
  let lastEnd: number | null = null;
  for (const item of items) {
    if (!("str" in item)) continue;
    const x = item.transform[4] as number;
    const y = item.transform[5] as number;
    if (current === null || lastY === null || Math.abs(y - lastY) > 2) {
      if (current !== null) lines.push(current);
      current = "";
      lastEnd = null;
    }
    if (lastEnd !== null && x - lastEnd > 1 && !current.endsWith(" ") && !item.str.startsWith(" ")) current += " ";
    current += item.str;
    lastY = item.hasEOL ? null : y;
    lastEnd = x + item.width;
  }
  if (current !== null) lines.push(current);
  return lines.map((l) => l.replace(/\s+/g, " ").trim());
}

/**
 * Text lines of every page, in page order, with an empty line after each page. Throws `DocumentParseError`:
 * `encrypted_pdf`, `not_a_pdf`, `too_many_pages` (more than `limits.maxPages`, default 60) or `unreadable_pdf`.
 */
export function pdfTextLines(data: Uint8Array, limits: Partial<PdfLimits> = {}): Promise<string[]> {
  return withPdf(data, limits, async (pdf) => {
    const lines: string[] = [];
    for (let n = 1; n <= pdf.numPages; n += 1) lines.push(...(await pageTextLines(await pdf.getPage(n))), "");
    return lines;
  });
}
