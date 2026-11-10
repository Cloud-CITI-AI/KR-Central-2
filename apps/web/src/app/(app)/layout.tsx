import type { ReactNode } from "react";
import { AppShell } from "@/components/shell/AppShell";
import { getMe } from "@/lib/session/get-me";

interface AppLayoutProps {
  readonly children: ReactNode;
}

/** Authenticated area: needs a session (401 redirects to sign-in), then the KR Central shell around the page. */
export default async function AppLayout({ children }: AppLayoutProps) {
  const me = await getMe();
  return <AppShell me={me}>{children}</AppShell>;
}
