/**
 * Shared primitives for the API contract. All request schemas are strict (unknown keys rejected — playbook A4/SC-B1).
 */
import { z } from "zod";

export const Uuid = z.uuid().meta({ description: "UUID identifier", example: "0f8fad5b-d9cb-469f-a165-70867728950e" });

/** Earliest/latest business date accepted: keeps date maths and Postgres timestamptz casts in range. */
export const ISO_DATE_MIN = "1900-01-01";
export const ISO_DATE_MAX = "2199-12-31";

export const IsoDate = z.iso
  .date()
  .refine((d) => d >= ISO_DATE_MIN && d <= ISO_DATE_MAX, {
    message: `Date must be between ${ISO_DATE_MIN} and ${ISO_DATE_MAX}`,
  })
  .meta({ description: "Calendar date (yyyy-mm-dd), Australia/Perth business date", example: "2026-06-14" });

export const IsoDateTime = z.iso
  .datetime({ offset: true })
  .meta({ description: "Instant (RFC 3339)", example: "2026-09-28T03:50:56.543Z" });

/** Postgres text cannot hold U+0000; the API's input guard refuses it everywhere, and these schemas say so too. */
const noNul = (value: string) => !value.includes("\0");
const NO_NUL = { message: "Must not contain NUL (U+0000) characters" } as const;

/**
 * True when `value` is empty or only white space and invisible format characters (Unicode Cf: zero-width space, joiners,
 * word joiner, BOM, soft hyphen, bidi marks ...). `trim()` alone leaves U+200B-U+200D, U+2060 and others, so a comment made
 * of them would look empty to a reader. The database twin is is_blank_text() (migration 0003, same character set).
 */
export function isBlank(value: string): boolean {
  return /^[\s\u0085\p{Cf}]*$/u.test(value);
}

/** Trimmed single-line text. */
export const ShortText = (max: number) => z.string().trim().min(1).max(max).refine(noNul, NO_NUL);
/** Trimmed multi-line text that may be empty. */
export const LongText = (max: number) => z.string().max(max).refine(noNul, NO_NUL);

/** Opaque pagination cursor. */
export const Cursor = z
  .string()
  .min(1)
  .max(512)
  .meta({ description: "Opaque cursor from a previous page's nextCursor" });

export const PaginationQuery = z.strictObject({
  cursor: Cursor.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50).meta({ description: "Page size (max 100, API-4)" }),
});

export function page<T extends z.ZodType>(item: T, id: string) {
  return z
    .object({
      items: z.array(item),
      nextCursor: z.string().nullable().meta({ description: "Cursor for the next page, or null on the last page" }),
    })
    .meta({ id });
}

/** Optimistic concurrency: entities carry an integer version, PATCH requests send `If-Match: "<version>"`. */
export const Version = z
  .number()
  .int()
  .min(1)
  .meta({ description: "Row version for optimistic concurrency (send as If-Match)" });

export const IfMatchHeader = z.strictObject({
  "if-match": z
    .string()
    .regex(/^"\d+"$/)
    .meta({ description: 'Current version of the resource, quoted (e.g. "3"). Missing → 428, stale → 412.' }),
});

export const IdempotencyKeyHeader = z.object({
  "idempotency-key": z.string().min(8).max(128).optional().meta({
    description: "Optional idempotency key; repeating a request with the same key returns the original result (API-5).",
  }),
});

export const CsrfHeader = z.object({
  "x-csrf-token": z
    .string()
    .min(16)
    .max(256)
    .meta({ description: "CSRF token from GET /v1/me (required on every state-changing request)" }),
});

/** RFC 9457 problem details (EH-1/API-3). */
export const Problem = z
  .object({
    type: z
      .string()
      .meta({ description: "Stable problem type URI (see PROBLEM_TYPES)", example: "urn:kr:problem:validation" }),
    title: z.string(),
    status: z.number().int(),
    detail: z.string().optional(),
    instance: z.string().optional(),
    requestId: z.string(),
    errors: z
      .array(z.object({ path: z.string(), message: z.string() }))
      .optional()
      .meta({ description: "Field errors for validation problems" }),
  })
  .meta({ id: "Problem" });
export type Problem = z.infer<typeof Problem>;

export const PROBLEM_TYPES = {
  validation: "urn:kr:problem:validation",
  unauthenticated: "urn:kr:problem:unauthenticated",
  forbidden: "urn:kr:problem:forbidden",
  notFound: "urn:kr:problem:not-found",
  conflict: "urn:kr:problem:conflict",
  preconditionFailed: "urn:kr:problem:precondition-failed",
  preconditionRequired: "urn:kr:problem:precondition-required",
  payloadTooLarge: "urn:kr:problem:payload-too-large",
  unsupportedMediaType: "urn:kr:problem:unsupported-media-type",
  uriTooLong: "urn:kr:problem:uri-too-long",
  fileNotReady: "urn:kr:problem:file-not-ready",
  fileRejected: "urn:kr:problem:file-rejected",
  rateLimited: "urn:kr:problem:rate-limited",
  featureDisabled: "urn:kr:problem:feature-disabled",
  storageUnavailable: "urn:kr:problem:storage-unavailable",
  internal: "about:blank",
} as const;
export type ProblemType = (typeof PROBLEM_TYPES)[keyof typeof PROBLEM_TYPES];

export const UserRef = z
  .object({ id: Uuid, displayName: z.string() })
  .meta({ id: "UserRef", description: "Minimal user reference (no email — data minimisation)" });
export type UserRef = z.infer<typeof UserRef>;
