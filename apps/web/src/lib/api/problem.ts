import type { Problem } from "@kr/contracts";

/** `INTERNAL_PROBLEM_TYPE`. Kept here so the browser client does not load Zod for one string; problem.test.ts checks it. */
export const INTERNAL_PROBLEM_TYPE = "about:blank";

const isString = (value: unknown): value is string => typeof value === "string";
const isOptionalString = (value: unknown): boolean => value === undefined || isString(value);

/**
 * Whether a response body is an RFC 9457 problem as the API sends it (`Problem` in @kr/contracts). The same checks as the
 * schema, written out so the error path needs no Zod; problem.test.ts compares the two on a set of bodies. Fails closed:
 * anything else becomes a generic problem for the status.
 */
export function isProblem(body: unknown): body is Problem {
  if (typeof body !== "object" || body === null) return false;
  const p = body as Record<string, unknown>;
  return (
    isString(p.type) &&
    isString(p.title) &&
    typeof p.status === "number" &&
    Number.isInteger(p.status) &&
    isOptionalString(p.detail) &&
    isOptionalString(p.instance) &&
    isString(p.requestId) &&
    (p.errors === undefined ||
      (Array.isArray(p.errors) &&
        p.errors.every(
          (e: unknown) =>
            typeof e === "object" &&
            e !== null &&
            isString((e as Record<string, unknown>).path) &&
            isString((e as Record<string, unknown>).message),
        )))
  );
}

/** An RFC 9457 problem answered by the API (or synthesised for a non-problem failure). Carries the request id (EH-1). */
export class ApiProblem extends Error {
  readonly status: number;
  readonly type: string;
  readonly title: string;
  readonly detail: string | undefined;
  readonly requestId: string;
  readonly errors: readonly { readonly path: string; readonly message: string }[];

  constructor(problem: Problem) {
    super(problem.detail ?? problem.title);
    this.name = "ApiProblem";
    this.status = problem.status;
    this.type = problem.type;
    this.title = problem.title;
    this.detail = problem.detail;
    this.requestId = problem.requestId;
    this.errors = problem.errors ?? [];
  }

  /** 412: the If-Match version is stale (§5.1). */
  get isStale(): boolean {
    return this.status === 412;
  }
}

/** Parse a failed response: problem+json when the body is one, otherwise a generic problem for the status. */
export async function problemFromResponse(response: Response): Promise<ApiProblem> {
  const requestId = response.headers.get("x-request-id") ?? "";
  try {
    const body: unknown = await response.json();
    if (isProblem(body)) return new ApiProblem(body);
  } catch {
    // Not JSON (a platform error page): generic problem below.
  }
  return new ApiProblem({
    type: INTERNAL_PROBLEM_TYPE,
    title: response.statusText || "Request failed",
    status: response.status,
    requestId,
  });
}

/** No response at all (offline, reset): status 0. */
export function networkProblem(): ApiProblem {
  return new ApiProblem({
    type: INTERNAL_PROBLEM_TYPE,
    title: "Network error",
    status: 0,
    detail: "The server could not be reached.",
    requestId: "",
  });
}
