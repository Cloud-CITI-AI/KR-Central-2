import { Problem, PROBLEM_TYPES } from "@kr/contracts";

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
    const parsed = Problem.safeParse(await response.json());
    if (parsed.success) return new ApiProblem(parsed.data);
  } catch {
    // Not JSON (a platform error page): generic problem below.
  }
  return new ApiProblem({
    type: PROBLEM_TYPES.internal,
    title: response.statusText || "Request failed",
    status: response.status,
    requestId,
  });
}

/** No response at all (offline, reset): status 0. */
export function networkProblem(): ApiProblem {
  return new ApiProblem({
    type: PROBLEM_TYPES.internal,
    title: "Network error",
    status: 0,
    detail: "The server could not be reached.",
    requestId: "",
  });
}
