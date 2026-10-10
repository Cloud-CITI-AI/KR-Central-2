/** The document tasks that run inside the parse thread, and what each returns. Shared by both sides; no parser import. */
import type {
  ApprovalDates,
  ConformedCandidate,
  ParsedCondition,
  ParsedEmail,
  PdfFirstPage,
} from "@kr/document-parsing";

export interface TaskInputs {
  /** The numbered conditions and the approval dates of a Decision Letter (all pages). */
  "decision-letter": { readonly data: Uint8Array; readonly maxPages: number };
  /** Page 1 text lines and annotation texts. */
  "pdf-first-page": { readonly data: Uint8Array; readonly maxPages: number };
  /**
   * The conformed date offered by a stamp annotation and by the text of page 1 (the two readers that need no AI). Reads page 1
   * of a document of any length unless a `maxPages` cap is given (PRODUCT_SPEC §10.1; the cap is for full-text reads).
   */
  "conformance-page": { readonly data: Uint8Array; readonly maxPages?: number };
  /** Page 1 as a PNG for the stamp reader (any length of document unless a `maxPages` cap is given). */
  "pdf-render": { readonly data: Uint8Array; readonly maxPages?: number };
  /** An Outlook .msg or an .eml, told apart by its first bytes. */
  email: { readonly data: Uint8Array };
}

export interface TaskOutputs {
  "decision-letter": { conditions: ParsedCondition[]; dates: ApprovalDates };
  "pdf-first-page": PdfFirstPage;
  "conformance-page": {
    annotation: ConformedCandidate<"stamp_annotation"> | null;
    text: ConformedCandidate<"text"> | null;
  };
  "pdf-render": Uint8Array;
  email: ParsedEmail;
}

export type TaskName = keyof TaskInputs;

/** What the parent hands the thread as `workerData`. */
export type TaskRequest = { [K in TaskName]: { readonly task: K } & TaskInputs[K] }[TaskName];

/** What the thread posts back: a value, or a code (a DocumentParseErrorCode, or `parse_failed` for anything else). */
export type ThreadReply =
  { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly code: string };
