import { getEnv } from "@/env";
import { ensureRequestId } from "@/lib/request-id";
import { hasControlChars } from "@/lib/security/chars";
import { buildDownstreamHeaders, buildUpstreamHeaders } from "./headers";
import { problemResponse } from "./problem";
import { isStreamingRequest } from "./streaming";

export interface ProxyOptions {
  /** Defaults to the validated `API_INTERNAL_URL`. */
  readonly apiUrl?: string;
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
}

type StreamingInit = RequestInit & { duplex: "half" };

const hasBody = (method: string) => method !== "GET" && method !== "HEAD";
const isSafeSegment = (s: string) =>
  s !== "" && s !== "." && s !== ".." && !s.includes("/") && !s.includes("\\") && !hasControlChars(s);

/**
 * Same-origin streaming proxy to the private API (ADR-0005). No business logic: the allowlisted request headers go
 * through, request and response bodies are streamed (uploads, zips, Range), every Set-Cookie survives, redirects are
 * handed to the browser unfollowed, and an upstream failure becomes a 502 problem+json.
 */
export async function proxyToApi(
  request: Request,
  segments: readonly string[],
  { apiUrl, timeoutMs = 30_000, fetchImpl = fetch }: ProxyOptions = {},
): Promise<Response> {
  const requestId = ensureRequestId(request.headers.get("x-request-id"));
  if (!segments.every(isSafeSegment)) return problemResponse(404, "Not found", requestId);

  let base: string;
  try {
    base = apiUrl ?? getEnv().API_INTERNAL_URL;
  } catch {
    return problemResponse(500, "Internal Server Error", requestId);
  }

  const { search, protocol } = new URL(request.url);
  const apiPath = `/v1/${segments.map(encodeURIComponent).join("/")}`;
  const timeout = isStreamingRequest(request.method, apiPath) ? [] : [AbortSignal.timeout(timeoutMs)];
  const init: StreamingInit = {
    method: request.method,
    headers: buildUpstreamHeaders(request.headers, requestId, protocol),
    body: hasBody(request.method) ? request.body : null,
    duplex: "half",
    redirect: "manual",
    cache: "no-store",
    signal: AbortSignal.any([request.signal, ...timeout]),
  };

  try {
    const upstream = await fetchImpl(`${base}${apiPath}${search}`, init);
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: buildDownstreamHeaders(upstream.headers, requestId),
    });
  } catch {
    if (request.signal.aborted) return new Response(null, { status: 499 });
    return problemResponse(502, "Bad Gateway", requestId, "The service is temporarily unavailable. Please try again.");
  }
}
