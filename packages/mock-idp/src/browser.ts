/** A minimal browser for tests without Playwright: follows the IdP's redirects (with its cookies) up to the callback. */
import type { MockIdp } from "./index.js";

/**
 * GET `authorizeUrl` (optionally with `login_hint`) and follow redirects inside the IdP. Resolves to the URL the IdP
 * finally redirects to (the callback with `code`+`state`, or `error=access_denied`).
 */
export async function followAuthorize(
  idp: Pick<MockIdp, "authorityHost">,
  authorizeUrl: string,
  loginHint?: string,
): Promise<URL> {
  const jar = new Map<string, string>();
  let current = new URL(authorizeUrl);
  if (loginHint !== undefined) current.searchParams.set("login_hint", loginHint);
  for (let hop = 0; hop < 12; hop++) {
    const res = await fetch(current, {
      redirect: "manual",
      headers: { cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; ") },
    });
    for (const c of res.headers.getSetCookie()) {
      const [pair = ""] = c.split(";");
      const eq = pair.indexOf("=");
      if (c.includes("Max-Age=0") || c.includes("1970")) jar.delete(pair.slice(0, eq));
      else jar.set(pair.slice(0, eq), pair.slice(eq + 1));
    }
    const location = res.headers.get("location");
    if (location === null) throw new Error(`Mock IdP answered ${res.status} without a redirect at ${current.pathname}`);
    const next = new URL(location, current);
    if (next.origin !== new URL(idp.authorityHost).origin) return next;
    current = next;
  }
  throw new Error("Mock IdP redirected too many times");
}
