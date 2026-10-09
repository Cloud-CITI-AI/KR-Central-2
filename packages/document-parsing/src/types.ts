/**
 * Public types of @kr/document-parsing. The implementation (WP-02) ports the prototype's parsers
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

/** How a conformed date was found (the `jobs.conformed_method` values; "manual" is set by hand and never parsed). */
export type ConformedMethod = "file_name" | "stamp_annotation" | "stamp_image" | "text";

/** A conformed date offered by one of the three non-AI readers; the worker applies the §10.1 order. */
export interface ConformedCandidate<M extends ConformedMethod = ConformedMethod> {
  /** ISO yyyy-mm-dd. */
  readonly date: string;
  readonly method: M;
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
  /** A PDF with more pages than this is rejected with a `too_many_pages` error, not truncated (decision letters are short; protects the worker; PRODUCT_SPEC §15). */
  readonly maxPages: number;
}
