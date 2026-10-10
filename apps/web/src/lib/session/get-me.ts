import { Me } from "@kr/contracts";
import { redirect } from "next/navigation";
import { cache } from "react";
import { signInHref } from "@/lib/api/client";
import { problemFromResponse } from "@/lib/api/problem";
import { fetchUpstream } from "./upstream";

/**
 * Server-side `GET /v1/me`: calls the private API directly with the browser's cookie (same allowlisted forwarding as the
 * BFF). No session → null. Any other failure throws (error.tsx shows the request id). Memoised per request.
 */
const loadMe = cache(async (): Promise<{ readonly me: Me | null; readonly returnTo: string }> => {
  const { response, returnTo } = await fetchUpstream("/v1/me");
  if (response.status === 401) return { me: null, returnTo };
  if (!response.ok) throw await problemFromResponse(response);
  return { me: Me.parse(await response.json()), returnTo };
});

/** The signed-in user, or null when there is no session (the not-found page still has to render for them). */
export async function getOptionalMe(): Promise<Me | null> {
  return (await loadMe()).me;
}

/** For the authenticated layout: 401 redirects to sign-in with the proxy-validated returnTo. */
export async function getMe(): Promise<Me> {
  const { me, returnTo } = await loadMe();
  if (!me) redirect(signInHref(returnTo));
  return me;
}
