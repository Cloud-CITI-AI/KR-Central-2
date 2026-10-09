/** Request ids travel end to end (browser → web → API → logs). Accept a client-supplied one only if it is inert. */
const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{8,128}$/;

export function ensureRequestId(incoming: string | null | undefined): string {
  return incoming && SAFE_REQUEST_ID.test(incoming) ? incoming : crypto.randomUUID();
}
