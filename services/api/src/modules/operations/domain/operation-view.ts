/**
 * An operations row as the API shows it (contract Operation). Pure. The worker stores a user-facing failure message, but
 * the API never relays text it has not vetted: known codes get a fixed message owned here, and an unknown code's message
 * is shown only when it looks like plain prose (no stack frames, paths, SQL or addresses), else a generic one (PRODUCT_SPEC §10).
 */
import { ConditionsExtractResult, ConformanceReadResult, FileScanResult, type Operation } from "@kr/contracts";
import type { OperationRow } from "@kr/db";

export const GENERIC_FAILURE = "The task could not be completed. Try again, or contact KR Surveys if it keeps failing.";

/** Messages for the codes the document tasks and the queue record (DocumentParseErrorCode, lease expiry, time limit). */
const KNOWN_FAILURES: Readonly<Record<string, string>> = {
  not_a_pdf: "That file is not a PDF, so it could not be read.",
  encrypted_pdf: "The PDF is password-protected, so it could not be read.",
  too_many_pages: "The PDF has too many pages to read.",
  unreadable_pdf: "The PDF could not be read. It may be damaged or a scanned image.",
  render_failed: "The first page of the PDF could not be read.",
  invalid_msg: "That file is not a readable Outlook message.",
  invalid_eml: "That file is not a readable email.",
  timeout: "Reading the document took too long. Try again.",
  lease_expired: "The task did not finish in time. Try again.",
};

const CODE_FORMAT = /^[a-z0-9_.-]{1,80}$/;
const MAX_MESSAGE_LENGTH = 300;
/** Things that mean the text came from an exception or a system, not from a person-oriented message. */
const LEAKY_TEXT =
  /(\n|\r|\bat\s+\S+\s*\(|\.(?:ts|js|mjs|cjs)\b|node_modules|(?:^|\s)\/[a-z]|https?:\/\/|\b(?:SELECT|INSERT|UPDATE|DELETE)\b|\b(?:E[A-Z]{3,}|SQLSTATE)\b|password|secret|token)/i;

export function safeFailure(code: string | null, message: string | null): { code: string; message: string } {
  const safeCode = code !== null && CODE_FORMAT.test(code) ? code : "failed";
  const known = KNOWN_FAILURES[safeCode];
  if (known) return { code: safeCode, message: known };
  const text = message?.trim() ?? "";
  const plain = text.length > 0 && text.length <= MAX_MESSAGE_LENGTH && !LEAKY_TEXT.test(text);
  return { code: safeCode, message: plain ? text : GENERIC_FAILURE };
}

/**
 * A file.scan result stored before the worker recorded its follow-up task has no `followUpOperationId`: read it as none,
 * so older rows still show their scan outcome.
 */
function withFollowUpDefault(result: unknown): unknown {
  return typeof result === "object" && result !== null && !Array.isArray(result)
    ? { followUpOperationId: null, ...result }
    : result;
}

/** The result only for the task types that have one, and only when it matches the contract. */
function resultOf(row: Pick<OperationRow, "type" | "result">, onUnreadable?: () => void): Operation["result"] {
  if (row.result === null || row.result === undefined || row.type === "email.parse") return null;
  const parsed =
    row.type === "conditions.extract"
      ? ConditionsExtractResult.safeParse(row.result)
      : row.type === "conformance.read"
        ? ConformanceReadResult.safeParse(row.result)
        : FileScanResult.safeParse(withFollowUpDefault(row.result));
  if (parsed.success) return parsed.data;
  onUnreadable?.();
  return null;
}

/** @param onUnreadableResult called when a succeeded task's stored result does not match the contract (the caller logs it) */
export function toOperation(row: OperationRow, onUnreadableResult?: () => void): Operation {
  return {
    id: row.id,
    jobId: row.job_id,
    type: row.type,
    status: row.status,
    createdAt: row.created_at.toISOString(),
    completedAt: row.completed_at ? row.completed_at.toISOString() : null,
    result: row.status === "succeeded" ? resultOf(row, onUnreadableResult) : null,
    error: row.status === "failed" ? safeFailure(row.error_code, row.error_message) : null,
  };
}
