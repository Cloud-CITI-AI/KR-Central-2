import type { ReactNode } from "react";
import { SignedInShell } from "@/components/ui/SignedInShell";
import { getMe } from "@/lib/session/get-me";

interface AppLayoutProps {
  readonly children: ReactNode;
}

/** Authenticated area: needs a session (401 redirects to sign-in), then hero header, banners, page and footer. */
export default async function AppLayout({ children }: AppLayoutProps) {
  const me = await getMe();
  return <SignedInShell me={me}>{children}</SignedInShell>;
}
