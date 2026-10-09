import { PDFDocument, PDFName, PDFString, StandardFonts } from "pdf-lib";

/** A synthetic PDF: one string array per page, one line of text per string; `annotation` adds a FreeText annotation to page 1. */
export async function makePdf(pages: readonly (readonly string[])[], annotation?: string): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (const lines of pages) {
    const page = pdf.addPage([595, 842]);
    lines.forEach((line, i) => {
      page.drawText(line, { x: 50, y: 780 - i * 18, size: 11, font });
    });
  }
  if (annotation !== undefined) {
    const first = pdf.getPage(0);
    const note = pdf.context.register(
      pdf.context.obj({
        Type: "Annot",
        Subtype: "FreeText",
        Rect: [300, 700, 560, 760],
        Contents: PDFString.of(annotation),
        DA: PDFString.of("/Helv 10 Tf 0 g"),
      }),
    );
    first.node.set(PDFName.of("Annots"), pdf.context.obj([note]));
  }
  return pdf.save();
}
