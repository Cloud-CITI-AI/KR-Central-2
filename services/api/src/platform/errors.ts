/**
 * Typed application errors and their RFC 9457 problem+json mapping (BE-4, EH-1). Domain and handler code throws
 * AppError subclasses; the error handler turns them (and zod, Fastify and unknown errors) into one response shape
 * that carries the request id and never leaks internals.
 */
import { PROBLEM_TYPES, type Problem, type ProblemType } from "@kr/contracts";
import { StorageUnavailableError } from "@kr/storage";
import type { FastifyError, FastifyInstance, FastifyRequest } from "fastify";
import { hasZodFastifySchemaValidationErrors, isResponseSerializationError } from "fastify-type-provider-zod";

export interface FieldError {
  readonly path: string;
  readonly message: string;
}

export interface AppErrorOptions {
  /** Human-readable explanation; never include secrets, tokens or personal data. */
  readonly detail?: string;
  /** Override the default problem type (e.g. PROBLEM_TYPES.fileNotReady on a 409). */
  readonly type?: ProblemType;
  readonly errors?: readonly FieldError[];
  readonly headers?: Readonly<Record<string, string>>;
  readonly cause?: unknown;
}

export class AppError extends Error {
  readonly type: ProblemType;
  readonly detail: string | undefined;
  readonly errors: readonly FieldError[] | undefined;
  readonly headers: Readonly<Record<string, string>>;

  constructor(
    readonly status: number,
    defaultType: ProblemType,
    readonly title: string,
    opts: AppErrorOptions = {},
  ) {
    super(opts.detail ?? title, opts.cause === undefined ? undefined : { cause: opts.cause });
    this.name = new.target.name;
    this.type = opts.type ?? defaultType;
    this.detail = opts.detail;
    this.errors = opts.errors;
    this.headers = opts.headers ?? {};
  }
}

export class BadRequestError extends AppError {
  constructor(opts?: AppErrorOptions) {
    super(400, PROBLEM_TYPES.validation, "Validation failed", opts);
  }
}
export class UnauthenticatedError extends AppError {
  constructor(opts?: AppErrorOptions) {
    super(401, PROBLEM_TYPES.unauthenticated, "Authentication required", opts);
  }
}
export class ForbiddenError extends AppError {
  constructor(opts?: AppErrorOptions) {
    super(403, PROBLEM_TYPES.forbidden, "Forbidden", opts);
  }
}
export class NotFoundError extends AppError {
  constructor(opts?: AppErrorOptions) {
    super(404, PROBLEM_TYPES.notFound, "Not found", opts);
  }
}
export class ConflictError extends AppError {
  constructor(opts?: AppErrorOptions) {
    super(409, PROBLEM_TYPES.conflict, "Conflict", opts);
  }
}
export class PreconditionFailedError extends AppError {
  constructor(opts?: AppErrorOptions) {
    super(412, PROBLEM_TYPES.preconditionFailed, "Precondition failed", opts);
  }
}
export class PreconditionRequiredError extends AppError {
  constructor(opts?: AppErrorOptions) {
    super(428, PROBLEM_TYPES.preconditionRequired, "Precondition required", opts);
  }
}
export class PayloadTooLargeError extends AppError {
  constructor(opts?: AppErrorOptions) {
    super(413, PROBLEM_TYPES.payloadTooLarge, "Payload too large", opts);
  }
}
export class UnsupportedMediaTypeError extends AppError {
  constructor(opts?: AppErrorOptions) {
    super(415, PROBLEM_TYPES.unsupportedMediaType, "Unsupported media type", opts);
  }
}
export class TooManyRequestsError extends AppError {
  constructor(retryAfterSeconds: number, opts?: AppErrorOptions) {
    super(429, PROBLEM_TYPES.rateLimited, "Too many requests", {
      ...opts,
      headers: { ...opts?.headers, "retry-after": String(Math.max(1, Math.ceil(retryAfterSeconds))) },
    });
  }
}
export class ServiceUnavailableError extends AppError {
  constructor(opts?: AppErrorOptions) {
    super(503, PROBLEM_TYPES.internal, "Service unavailable", opts);
  }
}

/** Seconds a client should wait before retrying after a storage outage. */
export const STORAGE_RETRY_AFTER_SECONDS = 5;

const INTERNAL_TITLE = "Internal server error";
const MALFORMED_DETAIL = "The request could not be parsed.";

/** "/items/0/name" → "items.0.name"; empty (request-level issue) → the request part (body, query …). */
function fieldPath(instancePath: string, context: string): string {
  const path = instancePath.replace(/^\//, "").replaceAll("/", ".");
  return path === "" ? context : path;
}

/** Postgres 22021 (invalid byte sequence for encoding, e.g. NUL in text) and 22P05 (NUL in jsonb). */
function isUntranslatableText(error: unknown): boolean {
  const code = typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;
  return code === "22021" || code === "22P05";
}

export interface MappedProblem {
  readonly problem: Problem;
  readonly headers: Readonly<Record<string, string>>;
}

/** Map any thrown value to a problem. Pure; the caller logs. */
export function toProblem(error: unknown, requestId: string, instance?: string): MappedProblem {
  const base = (status: number, type: string, title: string, extra: Partial<Problem> = {}): Problem => ({
    type,
    title,
    status,
    ...extra,
    ...(instance === undefined ? {} : { instance }),
    requestId,
  });

  if (error instanceof AppError) {
    return {
      headers: error.headers,
      problem: base(error.status, error.type, error.title, {
        ...(error.detail === undefined ? {} : { detail: error.detail }),
        ...(error.errors === undefined ? {} : { errors: [...error.errors] }),
      }),
    };
  }
  if (hasZodFastifySchemaValidationErrors(error)) {
    const context = (error as { validationContext?: string }).validationContext ?? "request";
    const errors = error.validation.map((v) => ({
      path: fieldPath(v.instancePath, context),
      message: v.message ?? "Invalid value",
    }));
    return { headers: {}, problem: base(400, PROBLEM_TYPES.validation, "Validation failed", { errors }) };
  }
  if (error instanceof StorageUnavailableError) {
    return toProblem(
      new ServiceUnavailableError({
        type: PROBLEM_TYPES.storageUnavailable,
        detail: "File storage is temporarily unavailable. Try again shortly.",
        headers: { "retry-after": String(STORAGE_RETRY_AFTER_SECONDS) },
      }),
      requestId,
      instance,
    );
  }
  if (isUntranslatableText(error)) {
    // Backstop for text Postgres cannot store (U+0000): client input never produces a 5xx. The input guard names the field first.
    return toProblem(new BadRequestError({ detail: MALFORMED_DETAIL }), requestId, instance);
  }
  if (typeof error === "object" && error !== null && !isResponseSerializationError(error)) {
    const { statusCode, code } = error as Partial<FastifyError>;
    if (statusCode === 413) return toProblem(new PayloadTooLargeError(), requestId, instance);
    if (statusCode === 415) return toProblem(new UnsupportedMediaTypeError(), requestId, instance);
    if (typeof statusCode === "number" && statusCode >= 400 && statusCode < 500 && typeof code === "string") {
      return toProblem(new BadRequestError({ detail: MALFORMED_DETAIL }), requestId, instance);
    }
  }
  return { headers: {}, problem: base(500, PROBLEM_TYPES.internal, INTERNAL_TITLE) };
}

function describeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code;
    return {
      errName: error.name,
      errMessage: error.message,
      ...(typeof code === "string" ? { errCode: code } : {}),
      stack: error.stack,
    };
  }
  return { errName: typeof error };
}

export function requestInstance(request: FastifyRequest): string {
  return request.url.split("?")[0] ?? request.url;
}

/** Install the problem+json error and not-found handlers on the root instance. */
export function registerErrorHandling(app: FastifyInstance): void {
  app.setErrorHandler((error, request, reply) => {
    const { problem, headers } = toProblem(error, request.id, requestInstance(request));
    if (error instanceof StorageUnavailableError) {
      // Degraded, not a bug: the bucket is unreachable (readiness shows it too); nothing in the request was wrong.
      request.log.warn({ event: "storage_unavailable", ...describeError(error) }, "Object storage is unavailable");
    } else if (problem.status >= 500) {
      request.log.error({ event: "request_failed", status: problem.status, ...describeError(error) }, "Request failed");
    }
    void reply.code(problem.status).headers(headers).type("application/problem+json").send(problem);
  });
  app.setNotFoundHandler((request, reply) => {
    const { problem } = toProblem(new NotFoundError(), request.id, requestInstance(request));
    void reply.code(404).type("application/problem+json").send(problem);
  });
}
