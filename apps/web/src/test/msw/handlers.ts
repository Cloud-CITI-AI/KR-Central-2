import { getRoute, Problem, PROBLEM_TYPES, toFastifyPath, type OperationId } from "@kr/contracts";
import { http, HttpResponse, type HttpHandler, type HttpResponseResolver, type JsonBodyType } from "msw";

type Method = "get" | "post" | "put" | "patch" | "delete";

/** A handler for one contract operation, with method and path taken from `ROUTES` (never retyped in a test). */
export function handlerFor(operationId: OperationId, resolver: HttpResponseResolver): HttpHandler {
  const route = getRoute(operationId);
  return http[route.method.toLowerCase() as Method](`*/api${toFastifyPath(route.path)}`, resolver);
}

/** Answer `operationId` with `body`, checked against the contract's schema for `status` so fixtures cannot drift. */
export function mockApi(operationId: OperationId, body: unknown, status = 200): HttpHandler {
  const schema = getRoute(operationId).responses[status]?.schema;
  return handlerFor(operationId, () =>
    HttpResponse.json((schema ? schema.parse(body) : body) as JsonBodyType, { status }),
  );
}

/** A 429 with `Retry-After` (§14) for `operationId`: problem+json carrying `requestId`. */
export function mockRateLimited(operationId: OperationId, requestId = "req-429"): HttpHandler {
  return handlerFor(operationId, () =>
    HttpResponse.json(
      { type: PROBLEM_TYPES.rateLimited, title: "Too many requests", status: 429, requestId },
      { status: 429, headers: { "content-type": "application/problem+json", "retry-after": "30" } },
    ),
  );
}

/** The request never arrives (connection lost): the client sees status 0. */
export function mockOffline(operationId: OperationId): HttpHandler {
  return handlerFor(operationId, () => HttpResponse.error());
}

/** Answer with an RFC 9457 problem (contract shape), e.g. `mockProblem("updateJob", 412, PROBLEM_TYPES.preconditionFailed)`. */
export function mockProblem(
  operationId: OperationId,
  status: number,
  type: string = PROBLEM_TYPES.internal,
  extra: Partial<Problem> = {},
): HttpHandler {
  const problem = Problem.parse({ type, title: `Problem ${status}`, status, requestId: "req-test-0001", ...extra });
  return handlerFor(operationId, () =>
    HttpResponse.json(problem, { status, headers: { "content-type": "application/problem+json" } }),
  );
}
