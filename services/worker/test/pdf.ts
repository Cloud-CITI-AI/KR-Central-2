import { PDFDocument, StandardFonts } from "pdf-lib";

/** A synthetic PDF: one string array per page, one line of text per string. */
export async function makePdf(pages: readonly (readonly string[])[]): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (const lines of pages) {
    const page = pdf.addPage([595, 842]);
    lines.forEach((line, i) => {
      page.drawText(line, { x: 50, y: 780 - i * 18, size: 11, font });
    });
  }
  return pdf.save();
}
