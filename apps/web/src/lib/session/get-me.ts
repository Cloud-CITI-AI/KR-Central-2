import { Me } from "@kr/contracts";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { getEnv } from "@/env";
import { signInHref } from "@/lib/api/client";
import { problemFromResponse } from "@/lib/api/problem";
import { buildUpstreamHeaders } from "@/lib/bff/headers";
import { ensureRequestId } from "@/lib/request-id";

/**
 * Server-side `GET /v1/me` for the authenticated layout: calls the private API directly with the browser's cookie
 * (same allowlisted forwarding as the BFF). 401 → redirect to sign-in with the proxy-validated returnTo. Memoised per
 * request. Any other failure throws (error.tsx shows the request id).
 */
export const getMe = cache(async (): Promise<Me> => {
  const incoming = await headers();
  const requestId = ensureRequestId(incoming.get("x-request-id"));
  const protocol = `${incoming.get("x-forwarded-proto") ?? "http"}:`;
  const response = await fetch(`${getEnv().API_INTERNAL_URL}/v1/me`, {
    headers: buildUpstreamHeaders(incoming, requestId, protocol),
    cache: "no-store",
    redirect: "manual",
    signal: AbortSignal.timeout(10_000),
  });
  if (response.status === 401) redirect(signInHref(incoming.get("x-return-to") ?? "/"));
  if (!response.ok) throw await problemFromResponse(response);
  return Me.parse(await response.json());
});
