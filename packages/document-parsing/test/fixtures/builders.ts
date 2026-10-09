/**
 * Synthetic fixture builders (TD-1: the prototype's real job is never reproduced). Everything is generated at test time
 * from a seeded faker, so names and addresses are fake and stable between runs.
 */
import { Faker, en, en_AU } from "@faker-js/faker";
import type { Agency } from "@kr/workflow";
import { PDFDocument, PDFHexString, PDFName, PDFString, StandardFonts } from "pdf-lib";

export function syntheticFaker(seed = 20260316): Faker {
  const f = new Faker({ locale: [en_AU, en] });
  f.seed(seed);
  return f;
}

/** A condition sentence whose wording alone makes `guessAgency` answer `agency` (see the keyword rules in §10.2). */
export function conditionText(agency: Agency, f: Faker = syntheticFaker()): string {
  const lot = f.number.int({ min: 1, max: 99 });
  const street = f.location.street();
  switch (agency) {
    case "Western Power":
      return `Underground electricity being provided to Lot ${lot} ${street}`;
    case "Water Corporation":
      return `Sewer connections being provided to Lot ${lot} ${street}`;
    case "Busselton Water":
      return `Busselton water supply being extended to Lot ${lot} ${street}`;
    case "Local Government":
      return `A crossover being constructed to Lot ${lot} ${street}`;
    case "WAPC":
      return `A notification being placed on the title of Lot ${lot} advising of ${f.lorem.words(3)}`;
  }
}

export interface SyntheticCondition {
  readonly text: string;
  /** Bracketed agency text appended as "(…)"; omit it to leave the agency to be guessed. */
  readonly bracket?: string;
}

export interface DecisionLetterSpec {
  readonly letterDate?: string;
  readonly conditions: readonly SyntheticCondition[];
  readonly adviceNotes?: readonly string[];
  /** Sentence(s) after the advice notes, e.g. "This approval expires on 3 September 2027." */
  readonly closing?: readonly string[];
  /** Insert a footer ("Page n of N", "OFFICIAL") after every this many condition lines (default: never). */
  readonly footerEvery?: number;
}

/** Text lines of a Decision-Letter-like document as pdf.js would return them (page breaks are empty lines). */
export function decisionLetterLines(spec: DecisionLetterSpec, f: Faker = syntheticFaker()): string[] {
  const lines = [
    "Western Australian Planning Commission",
    spec.letterDate ?? "14 March 2026",
    f.person.fullName(),
    f.location.streetAddress(),
    `Application for subdivision approval - ${f.location.street()}`,
    "Conditional approval",
    "Conditions",
  ];
  let page = 1;
  spec.conditions.forEach((c, i) => {
    const sentence = `${c.text}${c.bracket ? ` (${c.bracket})` : ""}.`;
    // wrap like a PDF would: the first line carries the number
    const words = sentence.split(" ");
    const mid = Math.ceil(words.length / 2);
    lines.push(`${i + 1}. ${words.slice(0, mid).join(" ")}`, words.slice(mid).join(" "));
    if (spec.footerEvery && (i + 1) % spec.footerEvery === 0) {
      lines.push("", `Page ${page} of 9`, "OFFICIAL", "");
      page += 1;
    }
  });
  if (spec.adviceNotes) lines.push("Advice", ...spec.adviceNotes.map((n, i) => `${i + 1}. ${n}`));
  lines.push(...(spec.closing ?? []));
  return lines;
}

export function paginate<T>(items: readonly T[], perPage: number): T[][] {
  const pages: T[][] = [];
  for (let i = 0; i < items.length; i += perPage) pages.push(items.slice(i, i + perPage));
  return pages.length ? pages : [[]];
}

export interface PdfSpec {
  readonly pages: readonly (readonly string[])[];
  /** Draw "Page n of N" and "OFFICIAL" at the foot of every page, like a WAPC letter. */
  readonly footers?: boolean;
  /** Text of a FreeText annotation (a digital stamp) on page 1. */
  readonly stamp?: string;
  /** Page size in points (default A4, 595 x 842). */
  readonly pageSize?: readonly [number, number];
}

/** A text PDF (A4, Helvetica): each string is one line, drawn top to bottom; "" leaves a gap. */
export async function buildPdf(spec: PdfSpec): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  spec.pages.forEach((lines, p) => {
    const page = doc.addPage(spec.pageSize ? [...spec.pageSize] : [595, 842]);
    lines.forEach((line, i) => {
      page.drawText(line, { x: 50, y: 780 - i * 22, size: 11, font });
    });
    if (spec.footers) {
      page.drawText(`Page ${p + 1} of ${spec.pages.length}`, { x: 50, y: 40, size: 9, font });
      page.drawText("OFFICIAL", { x: 250, y: 25, size: 9, font });
    }
    if (p === 0 && spec.stamp) {
      const annotation = doc.context.obj({
        Type: "Annot",
        Subtype: "FreeText",
        Rect: [380, 700, 560, 740],
        Contents: PDFString.of(spec.stamp),
        DA: PDFString.of("/Helv 10 Tf 0 g"),
        F: 4,
      });
      page.node.set(PDFName.of("Annots"), doc.context.obj([doc.context.register(annotation)]));
    }
  });
  return doc.save();
}

/** `pageCount` empty pages. */
export const buildBlankPdf = (pageCount: number): Promise<Uint8Array> =>
  buildPdf({ pages: Array.from({ length: pageCount }, () => []) });

/** A decision letter PDF (25 lines per page, with footers) and the lines it was built from. */
export async function buildDecisionLetterPdf(
  spec: DecisionLetterSpec,
  f: Faker = syntheticFaker(),
): Promise<{ readonly bytes: Uint8Array; readonly lines: string[] }> {
  const lines = decisionLetterLines(spec, f);
  return { bytes: await buildPdf({ pages: paginate(lines, 25), footers: true }), lines };
}

/** A PDF whose trailer names a standard security handler: pdf.js asks for a password and none is given. */
export async function buildEncryptedPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage();
  const zeros = PDFHexString.of("00".repeat(32));
  const encrypt = doc.context.obj({ Filter: "Standard", V: 1, R: 2, O: zeros, U: zeros, P: -4 });
  doc.context.trailerInfo.Encrypt = doc.context.register(encrypt);
  doc.context.trailerInfo.ID = doc.context.obj([PDFHexString.of("11".repeat(16)), PDFHexString.of("11".repeat(16))]);
  return doc.save({ useObjectStreams: false });
}
