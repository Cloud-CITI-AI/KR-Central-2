/** Header policy of the same-origin BFF (ADR-0005): an allowlist inbound, hop-by-hop stripping outbound. */

/** Request headers forwarded to the API, nothing else (cookies are the browser's, never rewritten). */
export const FORWARDED_REQUEST_HEADERS = [
  "cookie",
  "content-type",
  "content-length",
  "if-match",
  "idempotency-key",
  "x-csrf-token",
  "range",
  "origin",
  "user-agent",
] as const;

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

/**
 * Headers for a request to the API. `x-forwarded-for` is passed exactly as the Railway edge sent it (never replaced by
 * this server's view of the socket) so the API's per-IP limits see the real client (API `TRUST_PROXY_HOPS=1`).
 */
export function buildUpstreamHeaders(incoming: Headers, requestId: string, publicProtocol: string): Headers {
  const out = new Headers();
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = incoming.get(name);
    if (value !== null) out.set(name, value);
  }
  const forwardedFor = incoming.get("x-forwarded-for");
  if (forwardedFor !== null) out.set("x-forwarded-for", forwardedFor);
  out.set("x-forwarded-proto", incoming.get("x-forwarded-proto") ?? publicProtocol.replace(/:$/, ""));
  const host = incoming.get("x-forwarded-host") ?? incoming.get("host");
  if (host !== null) out.set("x-forwarded-host", host);
  out.set("x-request-id", requestId);
  // Bytes are relayed untouched (Range, zips): never let the HTTP client negotiate a content coding.
  out.set("accept-encoding", "identity");
  return out;
}

/** Response headers for the browser: hop-by-hop headers (and those named in `Connection`) dropped, Set-Cookie kept whole. */
export function buildDownstreamHeaders(upstream: Headers, requestId: string): Headers {
  const dropped = new Set(HOP_BY_HOP);
  for (const token of upstream.get("connection")?.split(",") ?? []) dropped.add(token.trim().toLowerCase());
  const recoded = upstream.has("content-encoding");
  const out = new Headers();
  for (const [name, value] of upstream) {
    if (name === "set-cookie" || dropped.has(name)) continue;
    if (recoded && (name === "content-length" || name === "content-encoding")) continue;
    out.append(name, value);
  }
  for (const cookie of upstream.getSetCookie()) out.append("set-cookie", cookie);
  if (!out.has("x-request-id")) out.set("x-request-id", requestId);
  return out;
}
