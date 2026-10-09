import { deflateSync, crc32 } from "node:zlib";
import { PDFDocument, StandardFonts } from "pdf-lib";

/** A file for `setInputFiles` / the API client. Everything here is synthetic (TD-1). */
export interface SyntheticFile {
  readonly name: string;
  readonly mimeType: string;
  readonly buffer: Buffer;
}

/** A PDF with one string array per page, one line of text per string (so the worker's text rules can read it). */
export async function pdfFile(name: string, pages: readonly (readonly string[])[] = [["Synthetic test document"]]) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (const lines of pages) {
    const page = pdf.addPage([595, 842]);
    lines.forEach((line, i) => {
      page.drawText(line, { x: 50, y: 780 - i * 18, size: 11, font });
    });
  }
  return { name, mimeType: "application/pdf", buffer: Buffer.from(await pdf.save()) } satisfies SyntheticFile;
}

function chunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), body.length + 4);
  return out;
}

/** A small valid PNG (a blue-to-green gradient), so photo grids and the image viewer have something to show. */
export function pngFile(name: string, width = 64, height = 48): SyntheticFile {
  const rows: Buffer[] = [];
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(1 + width * 3);
    for (let x = 0; x < width; x++) {
      row[1 + x * 3] = 20;
      row[2 + x * 3] = Math.round((x / width) * 200) + 30;
      row[3 + x * 3] = Math.round((1 - y / height) * 200) + 30;
    }
    rows.push(row);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // truecolour
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.concat(rows))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  return { name, mimeType: "image/png", buffer: png };
}

/** The DWG signature the server sniffs (`AC10dd`, then binary data); the drawing itself is not real. */
export function dwgFile(name: string): SyntheticFile {
  return {
    name,
    mimeType: "application/octet-stream",
    buffer: Buffer.concat([Buffer.from("AC1032"), Buffer.alloc(120)]),
  };
}

export function textFile(name: string, text: string): SyntheticFile {
  return { name, mimeType: "text/plain", buffer: Buffer.from(text, "utf8") };
}

export interface SyntheticEmail {
  readonly subject: string;
  readonly from?: string;
  readonly to?: string;
  readonly body: string;
}

/** An RFC 822 message the worker parses (subject, sender, recipients, date, plain-text body). */
export function emlFile(name: string, email: SyntheticEmail): SyntheticFile {
  const lines = [
    `From: ${email.from ?? "Pat Planner <pat.planner@example.org>"}`,
    `To: ${email.to ?? "Sam Staff <sam.staff@krsurveys.com.au>"}`,
    `Subject: ${email.subject}`,
    "Date: Mon, 28 Sep 2026 15:50:00 +0800",
    "Message-ID: <synthetic-1@example.org>",
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "",
    email.body,
    "",
  ];
  return { name, mimeType: "message/rfc822", buffer: Buffer.from(lines.join("\r\n"), "utf8") };
}

/** Text lines of a WAPC Decision Letter in the shape §10.2 reads: approval date, expiry, numbered conditions, advice. */
export interface DecisionLetterCondition {
  readonly text: string;
  /** The bracketed agency, e.g. "Western Power"; omitted = no agency named (the parser guesses it). */
  readonly agency?: string;
}

export function decisionLetter(
  name: string,
  conditions: readonly DecisionLetterCondition[],
  approval = { date: "12 March 2026", expiry: "12 March 2028" },
): Promise<SyntheticFile> {
  return pdfFile(name, [
    [
      "Western Australian Planning Commission",
      "Decision on subdivision application 100001",
      `Date of decision: ${approval.date}`,
      "The Commission has approved the application subject to the following conditions.",
      `This approval is valid until close of business on ${approval.expiry}.`,
      "Conditions",
      ...conditions.map((c, i) => `${(i + 1).toString()}. ${c.text}${c.agency ? ` (${c.agency})` : ""}`),
      "Advice",
      "1. This is advice and not a condition.",
    ],
  ]);
}
