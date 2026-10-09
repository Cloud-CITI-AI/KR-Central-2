/** Why a document could not be parsed. Callers map the code to a user message (PRODUCT_SPEC §10); the text is for logs. */
export type DocumentParseErrorCode =
  "not_a_pdf" | "encrypted_pdf" | "too_many_pages" | "unreadable_pdf" | "render_failed" | "invalid_msg" | "invalid_eml";

/** The only error this package throws for bad input. The message never contains document content (A6). */
export class DocumentParseError extends Error {
  readonly code: DocumentParseErrorCode;

  constructor(code: DocumentParseErrorCode, message: string, options?: { readonly cause?: unknown }) {
    super(message, options);
    this.name = "DocumentParseError";
    this.code = code;
  }
}
