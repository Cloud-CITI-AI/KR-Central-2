/**
 * Next.js 16 proxy (the renamed middleware). Protected path (CODEOWNERS, FE-12): per-request nonce CSP (ADR-0005) and
 * the optimistic sign-in redirect. The real session check is the API's; this only saves a round trip. The matcher
 * excludes /api/*, /_next/* and static files, so uploads and downloads never pass through here (no body buffering).
 */
import { NextResponse, type NextRequest } from "next/server";
import { ensureRequestId } from "@/lib/request-id";
import { buildCsp, generateNonce } from "@/lib/security/csp";
import { safeReturnTo } from "@/lib/security/return-to";

export const SESSION_COOKIE = "__Host-kr_session";
const PUBLIC_PAGES: ReadonlySet<string> = new Set(["/sign-in", "/sign-in-error", "/signed-out"]);

export function signInUrl(returnTo: string | undefined): string {
  return returnTo && returnTo !== "/" ? `/sign-in?returnTo=${encodeURIComponent(returnTo)}` : "/sign-in";
}

export function proxy(request: NextRequest): NextResponse {
  const { pathname, search } = request.nextUrl;
  const returnTo = safeReturnTo(`${pathname}${search}`);

  if (!PUBLIC_PAGES.has(pathname.replace(/(?<=.)\/+$/, "")) && !request.cookies.has(SESSION_COOKIE)) {
    // Next rejects a relative Location here; the origin is the Host the edge forwarded (never a client header).
    const response = NextResponse.redirect(new URL(signInUrl(returnTo), request.nextUrl.origin));
    response.headers.set("cache-control", "no-store");
    return response;
  }

  const nonce = generateNonce();
  const csp = buildCsp(nonce, { dev: process.env.NODE_ENV === "development" });
  const requestId = ensureRequestId(request.headers.get("x-request-id"));
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("content-security-policy", csp);
  requestHeaders.set("x-request-id", requestId);
  if (returnTo) requestHeaders.set("x-return-to", returnTo);
  else requestHeaders.delete("x-return-to");

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("content-security-policy", csp);
  response.headers.set("x-request-id", requestId);
  return response;
}

export const config = {
  matcher: [
    {
      source: "/((?!api/|api$|_next/|.*\\.[A-Za-z0-9]+$).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
