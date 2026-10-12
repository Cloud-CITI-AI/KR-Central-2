import { safeReturnTo } from "@/lib/security/return-to";

/** The API's login redirect for an already validated `returnTo`, with the page's `#fragment` when there is one to keep. */
export function loginHref(returnTo: string | undefined, hash = ""): string {
  if (!returnTo) return "/api/v1/auth/login";
  // A fragment never reaches a server, so it is folded in here, in the browser: the same-origin rule is checked again.
  const withHash = hash.startsWith("#") && !returnTo.includes("#") ? safeReturnTo(`${returnTo}${hash}`) : undefined;
  return `/api/v1/auth/login?returnTo=${encodeURIComponent(withHash ?? returnTo)}`;
}
