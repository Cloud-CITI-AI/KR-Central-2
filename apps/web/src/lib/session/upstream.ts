import { headers } from "next/headers";
import { getEnv } from "@/env";
import { problemFromResponse, type ApiProblem } from "@/lib/api/problem";
import { buildUpstreamHeaders } from "@/lib/bff/headers";
import { ensureRequestId } from "@/lib/request-id";

/**
 * The API could not be reached (timeout, refused, reset). Its `digest` is the request id sent to the API, and Next keeps a digest an
 * error already has, so the 500 page shows an id that the web's error log line (instrumentation.ts) and the API's logs carry.
 */
export class UpstreamUnavailable extends Error {
  readonly digest: string;

  constructor(requestId: string, cause: unknown) {
    super("The API could not be reached.", { cause });
    this.name = "UpstreamUnavailable";
    this.digest = requestId;
  }
}

/** Server-side GET to the private API with the browser's cookie (same allowlisted forwarding as the BFF). */
export async function fetchUpstream(
  path: string,
): Promise<{ readonly response: Response; readonly returnTo: string; readonly requestId: string }> {
  const incoming = await headers();
  const requestId = ensureRequestId(incoming.get("x-request-id"));
  const protocol = `${incoming.get("x-forwarded-proto") ?? "http"}:`;
  try {
    const response = await fetch(`${getEnv().API_INTERNAL_URL}${path}`, {
      headers: buildUpstreamHeaders(incoming, requestId, protocol),
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    });
    return { response, returnTo: incoming.get("x-return-to") ?? "/", requestId };
  } catch (error) {
    throw new UpstreamUnavailable(requestId, error);
  }
}

/** The error for an API answer that is not usable, carrying the request id as `digest` (the API's own, else the one this request sent). */
export async function upstreamProblem(response: Response, requestId: string): Promise<ApiProblem & { digest: string }> {
  const problem = await problemFromResponse(response);
  return Object.assign(problem, { digest: problem.requestId || requestId });
}
