/**
 * Public types of @kr/document-parsing. The implementation (WP-05) ports the prototype's parsers
 * (extracted.js: datesIn, findConformedDate, dateFromName, parseConditions, agencyFrom, guessAgency,
 * findApprovalDates, cfb/parseMsg, mimeSplit/mimeText/parseEml, emailText, pdfText/page1) to pure, tested functions.
 * Rules functions take text and return data; only src/pdf touches pdf.js. Nothing here does network I/O.
 */
import type { Agency } from "@kr/workflow";

export interface ParsedCondition {
  /** Condition number as printed (1, 2, 3 …). */
  readonly number: number;
  readonly text: string;
  readonly agency: Agency;
  /** True when no agency was named in brackets and it was guessed from keywords. */
  readonly agencyGuessed: boolean;
}

export interface ApprovalDates {
  /** Letter date (first date in the first 40 lines), ISO yyyy-mm-dd. */
  readonly approvalDate: string | null;
  /** "close of business on …", "no longer be valid …", "expires …", or letter date + "valid for N years". */
  readonly approvalExpiry: string | null;
}

export interface ConformedDateFinding {
  readonly date: string;
  /** "conformed": a date on/after a line mentioning conformance; "letter": first date in the document. */
  readonly how: "conformed" | "letter";
}

export interface ParsedEmail {
  readonly subject: string;
  readonly from: string;
  readonly to: string;
  readonly cc: string;
  /** ISO instant or "" when unknown. */
  readonly date: string;
  readonly body: string;
}

export interface PdfFirstPage {
  /** Text lines of page 1 (items grouped by baseline). */
  readonly lines: readonly string[];
  /** Text from annotations on page 1 (digital stamps). */
  readonly annotations: readonly string[];
}

export interface PdfLimits {
  /** Stop after this many pages (decision letters are short; protects the worker). */
  readonly maxPages: number;
}
