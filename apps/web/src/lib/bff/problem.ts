import { PROBLEM_TYPES, type Problem } from "@kr/contracts";

/** RFC 9457 problem for failures that originate in the web tier itself (generic text: no internals, no stack). */
export function problemResponse(status: number, title: string, requestId: string, detail?: string): Response {
  const body: Problem = {
    type: status === 404 ? PROBLEM_TYPES.notFound : PROBLEM_TYPES.internal,
    title,
    status,
    ...(detail === undefined ? {} : { detail }),
    requestId,
  };
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/problem+json", "cache-control": "no-store", "x-request-id": requestId },
  });
}
