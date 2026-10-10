import { headers } from "next/headers";
import { getEnv } from "@/env";
import { buildUpstreamHeaders } from "@/lib/bff/headers";
import { ensureRequestId } from "@/lib/request-id";

/** Server-side GET to the private API with the browser's cookie (same allowlisted forwarding as the BFF). */
export async function fetchUpstream(path: string): Promise<{ readonly response: Response; readonly returnTo: string }> {
  const incoming = await headers();
  const requestId = ensureRequestId(incoming.get("x-request-id"));
  const protocol = `${incoming.get("x-forwarded-proto") ?? "http"}:`;
  const response = await fetch(`${getEnv().API_INTERNAL_URL}${path}`, {
    headers: buildUpstreamHeaders(incoming, requestId, protocol),
    cache: "no-store",
    redirect: "manual",
    signal: AbortSignal.timeout(10_000),
  });
  return { response, returnTo: incoming.get("x-return-to") ?? "/" };
}
