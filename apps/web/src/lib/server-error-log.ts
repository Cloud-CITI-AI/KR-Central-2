import { requestIdOf } from "./request-id";

/** What Next.js hands `onRequestError` about the request and where it failed (the parts that are logged). */
export interface FailedRequest {
  readonly path: string;
  readonly method: string;
  readonly headers: Record<string, string | string[] | undefined>;
}
export interface FailureContext {
  readonly routerKind: string;
  readonly routePath: string;
  readonly routeType: string;
  readonly renderSource?: string | undefined;
}

const MAX_TEXT = 2000;
const clip = (text: string): string => (text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}…` : text);

/**
 * One JSON log line for a server render error (ADR-0009: JSON logs, request ids end to end). `requestId` is the id the proxy gave the
 * request (also sent to the API as `x-request-id`), and `digest` is the reference the error page shows as "Request ID" (it is the
 * request id itself for upstream failures, otherwise Next's hash of the error), so either one finds the line. The query string is left
 * out of `path` and nothing from the request body or cookies is logged.
 */
export function serverErrorEntry(
  error: unknown,
  request: FailedRequest,
  context: FailureContext,
  now: Date,
): Record<string, unknown> {
  const failure = error instanceof Error ? error : undefined;
  const digest = typeof error === "object" && error !== null && "digest" in error ? String(error.digest) : null;
  return {
    level: "error",
    time: now.toISOString(),
    msg: "server render error",
    requestId: requestIdOf(request.headers["x-request-id"]),
    digest,
    method: request.method,
    path: request.path.split("?")[0],
    routePath: context.routePath,
    routeType: context.routeType,
    routerKind: context.routerKind,
    ...(context.renderSource ? { renderSource: context.renderSource } : {}),
    errorName: failure?.name ?? typeof error,
    errorMessage: clip(failure?.message ?? String(error)),
    ...(failure?.stack ? { stack: clip(failure.stack) } : {}),
  };
}

/** Writes the entry as one line to stderr (the platform's log stream), never throwing from inside the error hook. */
export function logServerError(
  error: unknown,
  request: FailedRequest,
  context: FailureContext,
  write: (line: string) => void = (line) => {
    process.stderr.write(line);
  },
  now: Date = new Date(),
): void {
  write(`${JSON.stringify(serverErrorEntry(error, request, context, now))}\n`);
}
