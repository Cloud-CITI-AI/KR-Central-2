import type { Metadata } from "next";
import { headers } from "next/headers";
import { NotFoundPage } from "@/components/ui/NotFoundPage";
import { SignedInShell } from "@/components/ui/SignedInShell";
import { getOptionalMe } from "@/lib/session/get-me";

export const metadata: Metadata = { title: "Page not found" };

/**
 * Branded 404 for URLs that match no route, with the request id. It sits outside the (app) layout, so it builds the signed-in
 * shell itself when there is a session (§4: name, theme, Admin, Sign out, footer) and a public page when there is none or the
 * session cannot be read: a 404 must never turn into an error page.
 */
export default async function NotFound() {
  const requestId = (await headers()).get("x-request-id");
  const me = await getOptionalMe().catch(() => null);
  if (!me) return <NotFoundPage requestId={requestId} />;
  return (
    <SignedInShell me={me}>
      <NotFoundPage requestId={requestId} inShell />
    </SignedInShell>
  );
}
