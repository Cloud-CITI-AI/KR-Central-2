/** Request ids travel end to end (browser → web → API → logs). Accept a client-supplied one only if it is inert. */
const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{8,128}$/;

export function ensureRequestId(incoming: string | null | undefined): string {
  return incoming && SAFE_REQUEST_ID.test(incoming) ? incoming : crypto.randomUUID();
}

/** The id of a request header value (a request id is a single string): null for a missing, repeated or unsafe one. */
export function requestIdOf(value: string | readonly string[] | undefined): string | null {
  return typeof value === "string" && SAFE_REQUEST_ID.test(value) ? value : null;
}
