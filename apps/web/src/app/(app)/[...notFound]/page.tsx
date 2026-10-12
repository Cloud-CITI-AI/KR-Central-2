import type { Metadata } from "next";
import { notFound } from "next/navigation";

export const metadata: Metadata = { title: "Page not found" };

/**
 * Catch-all for URLs that match no page. It exists so the signed-in 404 is rendered by the (app) group (its layout supplies the
 * shell, `(app)/not-found.tsx` the panel) instead of the root not-found, which every route's first load would carry. A request
 * with no valid session never gets this far: the proxy and the (app) layout send it to sign-in like any other page.
 */
export default function UnknownRoute(): never {
  notFound();
}
